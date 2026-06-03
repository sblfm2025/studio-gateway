import { db, Timestamp, addDocument, runFirestoreOperation, shouldSkipFirestoreOperation } from "../firebaseClient";
import { Logger } from "../logger";
import type { ProgramRecording, ProgramRecordingRule, RadiobossCommand } from "../types";
import { findValidAttendance } from "../attendance/attendanceReader";
import { getSchedulesNearNow, type NormalizedSchedule } from "../schedule/scheduleReader";
import { getDefaultRecordingRule, getRecordingRule, getRecordingRuleForSchedule } from "./recordingRules.service";
import { upsertProgramRecording } from "./recordingStatus.service";

const gatewayId = process.env.GATEWAY_ID || "studio-main";

function getAutoRecordingIntervalMs(): number {
  const raw = Number(process.env.AUTO_RECORDING_INTERVAL_SECONDS || 120);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 120000;
  return Math.min(600, Math.max(60, raw)) * 1000;
}

function safeId(value: string): string {
  return value.replace(/[/.#[\]$]/g, "_");
}

function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "program";
}

function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime() || 0;
}

async function getRuleForSchedule(schedule: NormalizedSchedule): Promise<ProgramRecordingRule> {
  const primary = await getRecordingRuleForSchedule(schedule.scheduleId, schedule.programId, schedule.programName);
  if (primary.recordingEnabled || schedule.programId === slugify(schedule.programName)) return primary;

  const secondaryId = slugify(schedule.programName);
  const secondary = await getRecordingRule(secondaryId);
  return secondary.recordingEnabled || secondary.allowManualOverride ? secondary : {
    ...getDefaultRecordingRule(secondaryId),
    programName: schedule.programName,
  };
}

async function isRadioBossOnline(): Promise<boolean> {
  const snapshot = await runFirestoreOperation(
    "get radiobossStatus/current",
    () => db.collection("radiobossStatus").doc("current").get(),
  );
  const data = snapshot.exists ? snapshot.data() : null;
  return Boolean(data?.radioBossOnline ?? data?.online);
}

async function hasPendingCommand(dedupeKey: string): Promise<boolean> {
  const snapshot = await runFirestoreOperation(
    "query radiobossCommands pending dedupe",
    () => db
      .collection("radiobossCommands")
      .where("dedupeKey", "==", dedupeKey)
      .where("status", "in", ["pending", "locked", "executing", "retryable"])
      .get(),
  );

  return snapshot.docs.length > 0;
}

async function hasCompletedCommand(dedupeKey: string): Promise<boolean> {
  const snapshot = await runFirestoreOperation(
    "query radiobossCommands completed dedupe",
    () => db
      .collection("radiobossCommands")
      .where("dedupeKey", "==", dedupeKey)
      .where("status", "in", ["success", "cancelled"])
      .limit(1)
      .get(),
  );

  return snapshot.docs.length > 0;
}

async function createSystemCommand(
  type: "START_RECORDING" | "STOP_RECORDING",
  payload: Record<string, any>,
  dedupeKey: string,
): Promise<string | null> {
  if (await hasPendingCommand(dedupeKey) || await hasCompletedCommand(dedupeKey)) return null;

  const command: Omit<RadiobossCommand, "id"> = {
    type,
    status: "pending",
    payload,
    requestedBy: `gateway:${gatewayId}`,
    requestedByName: "Studio Gateway Auto Recording",
    requestedAt: Timestamp.now(),
    priority: "normal",
    dedupeKey,
    attempts: 0,
    maxAttempts: 3,
    lockedBy: null,
    lockedAt: null,
    executedAt: null,
    gatewayId: null,
    result: null,
    errorCode: null,
    errorMessageSafe: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  return addDocument("radiobossCommands", command);
}

async function markScheduleRecording(
  recordingId: string,
  schedule: NormalizedSchedule,
  status: ProgramRecording["status"],
  patch: Partial<ProgramRecording> = {},
) {
  await upsertProgramRecording(recordingId, {
    programId: schedule.programId,
    programName: schedule.programName,
    scheduleId: schedule.scheduleId,
    announcerId: schedule.announcerId,
    announcerName: schedule.announcerName,
    plannedStartAt: Timestamp.fromDate ? Timestamp.fromDate(schedule.startsAt) : schedule.startsAt,
    plannedStopAt: Timestamp.fromDate ? Timestamp.fromDate(schedule.endsAt) : schedule.endsAt,
    gatewayId,
    status,
    ...patch,
  });
}

function isWithinStartWindow(now: Date, schedule: NormalizedSchedule, rule: ProgramRecordingRule): boolean {
  const startMs = schedule.startsAt.getTime();
  return now.getTime() >= startMs - rule.startGraceMinutes * 60000 &&
    now.getTime() <= startMs + rule.startGraceMinutes * 60000;
}

function isStopDue(now: Date, recording: ProgramRecording, rule: ProgramRecordingRule): boolean {
  const plannedStopMs = toMillis(recording.plannedStopAt);
  const plannedStartMs = toMillis(recording.plannedStartAt || recording.startedAt);
  const stopGraceDue = plannedStopMs > 0 && now.getTime() > plannedStopMs + rule.stopGraceMinutes * 60000;
  const plannedDurationMs = plannedStopMs > plannedStartMs ? plannedStopMs - plannedStartMs : 0;
  const maxOverrunDue = plannedStartMs > 0 &&
    plannedDurationMs > 0 &&
    now.getTime() > plannedStartMs + plannedDurationMs + (rule.maxOverrunMinutes * 60000);
  return stopGraceDue || maxOverrunDue;
}

async function getRecordingById(recordingId: string): Promise<ProgramRecording | null> {
  const snapshot = await runFirestoreOperation(
    `get programRecordings/${recordingId}`,
    () => db.collection("programRecordings").doc(recordingId).get(),
  );
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...(snapshot.data() as Omit<ProgramRecording, "id">) };
}

async function getActiveRecordings(): Promise<ProgramRecording[]> {
  const snapshot = await runFirestoreOperation(
    "query programRecordings active",
    () => db.collection("programRecordings").where("status", "==", "recording").get(),
  );
  return snapshot.docs.map((item: any) => ({ id: item.id, ...(item.data() as Omit<ProgramRecording, "id">) }));
}

async function evaluateSchedule(now: Date, schedule: NormalizedSchedule, radioBossOnline: boolean) {
  const rule = await getRuleForSchedule(schedule);
  const occurrenceKey = `${schedule.scheduleId}_${formatDateKey(schedule.startsAt)}`;
  const recordingId = `rec-${safeId(occurrenceKey)}`;
  const existing = await getRecordingById(recordingId);

  if (!rule.recordingEnabled) {
    await markScheduleRecording(recordingId, schedule, "skipped_disabled", {
      errorMessageSafe: "Recording rule program belum aktif.",
    });
    return;
  }

  if (!rule.autoStart) {
    await markScheduleRecording(recordingId, schedule, "ready");
    return;
  }

  if (!isWithinStartWindow(now, schedule, rule)) return;

  if (rule.requireAttendance) {
    const attendance = await findValidAttendance(schedule);
    if (!attendance) {
      await markScheduleRecording(recordingId, schedule, "waiting_attendance", {
        errorMessageSafe: "Rekaman menunggu absensi penyiar yang valid.",
      });
      return;
    }
  }

  if (!radioBossOnline) {
    await markScheduleRecording(recordingId, schedule, "radioboss_offline", {
      errorMessageSafe: "RadioBOSS tidak terdeteksi saat jadwal rekaman.",
    });
    return;
  }

  if (existing?.status === "recording") return;

  const commandId = await createSystemCommand(
    "START_RECORDING",
    {
      programId: rule.programId,
      programName: rule.programName || schedule.programName,
      scheduleId: schedule.scheduleId,
      announcerId: schedule.announcerId || schedule.announcerName,
      announcerName: schedule.announcerName || schedule.announcerId,
      recordingId,
      plannedStartAt: schedule.startsAt.toISOString(),
      plannedStopAt: schedule.endsAt.toISOString(),
      reason: "auto_recording_manager",
    },
    `START_RECORDING_${occurrenceKey}`,
  );

  if (commandId) {
    await markScheduleRecording(recordingId, schedule, "ready", {
      startCommandId: commandId,
      errorMessageSafe: null,
    });
    Logger.info(`[AutoRecording] Command START_RECORDING dibuat untuk ${schedule.programName}: ${commandId}`);
  }
}

async function stopOverdueRecordings(now: Date) {
  const recordings = await getActiveRecordings();

  for (const recording of recordings) {
    const rule = await getRecordingRule(recording.programId);
    if (!rule.autoStop || !isStopDue(now, recording, rule)) continue;

    const commandId = await createSystemCommand(
      "STOP_RECORDING",
      {
        recordingId: recording.id,
        reason: "auto_recording_manager_stop",
      },
      `STOP_RECORDING_${recording.id}_${formatDateKey(now)}`,
    );

    if (commandId) {
      Logger.info(`[AutoRecording] Command STOP_RECORDING dibuat untuk ${recording.id}: ${commandId}`);
    }
  }
}

export async function evaluateAutoRecording(): Promise<void> {
  if (shouldSkipFirestoreOperation("evaluate auto recording")) return;

  const now = new Date();
  const radioBossOnline = await isRadioBossOnline();
  const schedules = await getSchedulesNearNow(now);

  for (const schedule of schedules) {
    await evaluateSchedule(now, schedule, radioBossOnline);
  }

  await stopOverdueRecordings(now);
}

let isEvaluating = false;

export function startAutoRecordingManager(): NodeJS.Timeout {
  const intervalMs = getAutoRecordingIntervalMs();
  Logger.info(`[AutoRecording] Manager aktif. Evaluasi setiap ${intervalMs / 1000} detik.`);

  const run = async () => {
    if (isEvaluating) return;
    isEvaluating = true;
    try {
      await evaluateAutoRecording();
    } catch (error) {
      Logger.error(`[AutoRecording] Evaluasi gagal: ${String(error)}`);
    } finally {
      isEvaluating = false;
    }
  };

  void run();
  return setInterval(run, intervalMs);
}
