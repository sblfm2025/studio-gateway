import * as fs from "fs";
import * as path from "path";
import { db, Timestamp, setDocument, addDocument } from "../firebaseClient";
import { Logger } from "../logger";
import type { FirestoreAuditLog, ProgramRecording, RadiobossCommand } from "../types";
import { validateCommand } from "./commandValidator";
import { tryLockCommand } from "./commandLock";
import { SafeCommandError, toSafeCommandError } from "./commandTypes";
import { getRecordingRuleForSchedule } from "../recording/recordingRules.service";
import { buildRecordingFileName, buildRecordingFilePath } from "../recording/recordingFilename";
import {
  getProgramRecording,
  updateRecordingStatus,
  upsertProgramRecording,
} from "../recording/recordingStatus.service";
import { sendAllowedRadioBossCommand, sendRadioBossAction } from "../radioboss/radiobossCommandClient";

const COMMAND_BATCH_LIMIT = 10;
const gatewayId = process.env.GATEWAY_ID || "studio-main";

function getCommandPollIntervalMs(): number {
  const raw = Number(process.env.COMMAND_POLL_INTERVAL_SECONDS || 5);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 5000;
  return Math.min(60, Math.max(3, raw)) * 1000;
}

function getRecordingRoot(): string {
  const root = process.env.RADIO_SBL_RECORDING_ROOT;
  if (!root) {
    throw new SafeCommandError(
      "RECORDING_ROOT_MISSING",
      "Root folder rekaman belum dikonfigurasi di Gateway.",
      false,
    );
  }
  return root;
}

function getString(payload: Record<string, any>, field: string, fallback = ""): string {
  const value = payload[field];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeRadioBossMessage(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isConfiguredDummyRequestFile(filePath: string): boolean {
  const dummyPath = process.env.SONG_REQUEST_DUMMY_FILE_PATH;
  if (!dummyPath) return false;
  return path.resolve(filePath).toLowerCase() === path.resolve(dummyPath).toLowerCase();
}

function quoteCommandArg(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

function safeFirestoreId(value: string): string {
  return value.replace(/[/.#[\]$]/g, "_");
}

function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime() || 0;
}

function toTimestamp(value: any, fallback: any) {
  if (!value) return fallback;
  if (typeof value.toDate === "function") return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return Timestamp.fromDate ? Timestamp.fromDate(date) : date;
}

function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getOccurrenceKey(scheduleId: string, plannedStartAt: any): string {
  const date = plannedStartAt ? new Date(plannedStartAt) : new Date();
  return safeFirestoreId(`${scheduleId}_${formatDateKey(Number.isNaN(date.getTime()) ? new Date() : date)}`);
}

async function writeAuditLog(
  action: string,
  command: RadiobossCommand,
  result: "success" | "failed" | "skipped",
  details: Record<string, any>,
) {
  const auditData: FirestoreAuditLog = {
    action,
    mode: "write",
    gatewayId,
    requestedAt: Timestamp.now(),
    result,
    details: {
      commandId: command.id,
      commandType: command.type,
      ...details,
    },
  };
  await addDocument("radiobossAuditLogs", auditData);
}

async function getPendingCommands(): Promise<RadiobossCommand[]> {
  const snapshot = await db
    .collection("radiobossCommands")
    .where("status", "in", ["pending", "retryable"])
    .limit(COMMAND_BATCH_LIMIT)
    .get();

  return snapshot.docs
    .map((item: any) => ({ id: item.id, ...(item.data() as Omit<RadiobossCommand, "id">) }))
    .sort((left: RadiobossCommand, right: RadiobossCommand) => {
      const priorityScore = { high: 0, normal: 1, low: 2 };
      const leftPriority = priorityScore[left.priority || "normal"];
      const rightPriority = priorityScore[right.priority || "normal"];
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return toMillis(left.createdAt || left.requestedAt) - toMillis(right.createdAt || right.requestedAt);
    });
}

async function markExecuting(commandId: string) {
  await setDocument("radiobossCommands", commandId, {
    status: "executing",
    gatewayId,
    updatedAt: Timestamp.now(),
  });
}

async function markSuccess(commandId: string, result: Record<string, any>) {
  await setDocument("radiobossCommands", commandId, {
    status: "success",
    executedAt: Timestamp.now(),
    result,
    errorCode: null,
    errorMessageSafe: null,
    updatedAt: Timestamp.now(),
  });
}

async function markCancelled(commandId: string, result: Record<string, any>) {
  await setDocument("radiobossCommands", commandId, {
    status: "cancelled",
    executedAt: Timestamp.now(),
    result,
    errorCode: null,
    errorMessageSafe: null,
    lockedBy: null,
    lockedAt: null,
    updatedAt: Timestamp.now(),
  });
}

async function findSuccessfulCommandWithSameDedupeKey(command: RadiobossCommand): Promise<string | null> {
  if (!command.dedupeKey) return null;

  const snapshot = await db
    .collection("radiobossCommands")
    .where("dedupeKey", "==", command.dedupeKey)
    .where("status", "==", "success")
    .limit(5)
    .get();

  const duplicate = snapshot.docs
    .map((item: any) => ({ id: item.id, ...(item.data() as Omit<RadiobossCommand, "id">) }))
    .find((item: RadiobossCommand) => item.id !== command.id);

  return duplicate?.id || null;
}

async function markFailedOrRetryable(command: RadiobossCommand, error: SafeCommandError) {
  const attempts = (command.attempts || 0) + 1;
  const maxAttempts = command.maxAttempts || 3;
  const nextStatus = error.retryable && attempts < maxAttempts ? "retryable" : "failed";

  await setDocument("radiobossCommands", command.id, {
    status: nextStatus,
    attempts,
    errorCode: error.errorCode,
    errorMessageSafe: error.errorMessageSafe,
    updatedAt: Timestamp.now(),
    lockedBy: null,
    lockedAt: null,
  });
}

async function setRadioBossRecordingState(active: boolean, recordingId: string | null) {
  await setDocument("radiobossStatus", "current", {
    recordingActive: active,
    activeRecordingId: recordingId,
    updatedAt: Timestamp.now(),
    gatewayId,
  });
}

async function executeStartRecording(command: RadiobossCommand): Promise<Record<string, any>> {
  const programId = getString(command.payload, "programId");
  const scheduleId = getString(command.payload, "scheduleId");
  const announcerId = getString(command.payload, "announcerId", "unknown");
  const programName = getString(command.payload, "programName");
  const announcerName = getString(command.payload, "announcerName", announcerId);
  const rule = await getRecordingRuleForSchedule(scheduleId, programId, programName);

  if (!rule.recordingEnabled && !rule.allowManualOverride) {
    throw new SafeCommandError(
      "RECORDING_DISABLED",
      "Rule program belum mengizinkan rekaman atau manual override.",
      false,
    );
  }

  const now = new Date();
  const recordingId = getString(command.payload, "recordingId") || `rec-${getOccurrenceKey(scheduleId, command.payload.plannedStartAt)}`;
  const fileName = buildRecordingFileName({
    date: now,
    programName: programName || rule.programName || programId,
    announcerName,
    format: rule.format || "mp3",
  });
  const filePath = buildRecordingFilePath({
    root: getRecordingRoot(),
    date: now,
    folderSlug: rule.folderSlug || programId,
    fileName,
  });

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const recordingData: Partial<ProgramRecording> = {
    programId,
    programName: programName || rule.programName || programId,
    scheduleId,
    announcerId,
    announcerName,
    status: "recording",
    plannedStartAt: toTimestamp(command.payload.plannedStartAt, Timestamp.now()),
    plannedStopAt: toTimestamp(command.payload.plannedStopAt || command.payload.plannedEndAt, null),
    startedAt: Timestamp.now(),
    stoppedAt: null,
    durationSeconds: null,
    fileName,
    filePath,
    gatewayId,
    source: "radioboss_streamarchive",
    startCommandId: command.id,
    errorCode: null,
    errorMessageSafe: null,
  };

  await upsertProgramRecording(recordingId, recordingData);
  await sendAllowedRadioBossCommand(`streamarchive ${quoteCommandArg(filePath)}`);
  await setRadioBossRecordingState(true, recordingId);

  return { recordingId, fileName, filePath };
}

async function executeStopRecording(command: RadiobossCommand): Promise<Record<string, any>> {
  const recordingId = getString(command.payload, "recordingId");
  const recording = await getProgramRecording(recordingId);

  if (!recording || recording.status !== "recording") {
    throw new SafeCommandError(
      "RECORDING_NOT_ACTIVE",
      "Rekaman aktif tidak ditemukan atau statusnya bukan recording.",
      false,
    );
  }

  await updateRecordingStatus(recordingId, "stopping", { stopCommandId: command.id });
  await sendAllowedRadioBossCommand("streamarchive off");

  const stoppedAt = Timestamp.now();
  const durationSeconds = recording.startedAt
    ? Math.max(0, Math.round((toMillis(stoppedAt) - toMillis(recording.startedAt)) / 1000))
    : null;

  await updateRecordingStatus(recordingId, "completed", {
    stoppedAt,
    durationSeconds,
    stopCommandId: command.id,
    errorCode: null,
    errorMessageSafe: null,
  });
  await setRadioBossRecordingState(false, null);

  return { recordingId, durationSeconds };
}

async function executeMarkSkipped(command: RadiobossCommand): Promise<Record<string, any>> {
  const scheduleId = getString(command.payload, "scheduleId");
  const recordingId = getString(command.payload, "recordingId") || `rec-${getOccurrenceKey(scheduleId, command.payload.plannedStartAt)}`;
  const programId = getString(command.payload, "programId");
  const reason = getString(command.payload, "reason", "manual_operator_skip");

  await upsertProgramRecording(recordingId, {
    programId,
    programName: getString(command.payload, "programName", programId),
    scheduleId,
    status: "manual_override",
    plannedStartAt: toTimestamp(command.payload.plannedStartAt, null),
    gatewayId,
    errorMessageSafe: reason,
  });

  return { recordingId, reason };
}

async function executeAddTrackToQueue(command: RadiobossCommand): Promise<Record<string, any>> {
  const filePath = getString(command.payload, "filePath");
  const requestId = getString(command.payload, "requestId");
  const title = getString(command.payload, "title");
  const artist = getString(command.payload, "artist");
  const requesterName = getString(command.payload, "requesterName", "Pendengar Radio SBL");
  const requestMessage = sanitizeRadioBossMessage(getString(command.payload, "message"));
  const libraryRoot = process.env.RADIO_SBL_MUSIC_LIBRARY_ROOT;

  if (!libraryRoot) {
    throw new SafeCommandError(
      "MUSIC_LIBRARY_ROOT_MISSING",
      "Root folder music library belum dikonfigurasi di Gateway.",
      false,
    );
  }

  const resolvedRoot = path.resolve(libraryRoot);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  const isDummyRequestFile = isConfiguredDummyRequestFile(resolvedFile);

  if (!isDummyRequestFile && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new SafeCommandError(
      "MUSIC_PATH_OUTSIDE_ROOT",
      "File lagu berada di luar folder library yang diizinkan.",
      false,
    );
  }

  if (!fs.existsSync(resolvedFile)) {
    throw new SafeCommandError(
      "MUSIC_FILE_NOT_FOUND",
      "File lagu tidak ditemukan di PC studio.",
      false,
    );
  }

  const messageParts = [
    "Request Radio SBL",
    requesterName ? `dari ${requesterName}` : "",
    requestMessage || [artist, title].filter(Boolean).join(" - "),
    requestId ? `ID ${requestId}` : "",
  ].filter(Boolean);
  const responseText = await sendRadioBossAction("songrequest", {
    filename: resolvedFile,
    message: messageParts.join(" | "),
  });

  await setDocument("songRequests", requestId, {
    status: "queued",
    queuedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    gatewayId,
  });

  return { requestId, filePath: resolvedFile, radioBossResponse: responseText.trim() || "OK" };
}

async function executeRetryCommand(command: RadiobossCommand): Promise<Record<string, any>> {
  const targetCommandId = getString(command.payload, "commandId");
  const ref = db.collection("radiobossCommands").doc(targetCommandId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new SafeCommandError(
      "RETRY_TARGET_NOT_FOUND",
      "Command target retry tidak ditemukan.",
      false,
    );
  }

  const target = snapshot.data() as RadiobossCommand;
  if (!["failed", "retryable"].includes(target.status)) {
    throw new SafeCommandError(
      "RETRY_TARGET_NOT_ELIGIBLE",
      "Command target tidak berada pada status failed/retryable.",
      false,
    );
  }

  if ((target.attempts || 0) >= (target.maxAttempts || 3)) {
    throw new SafeCommandError(
      "RETRY_LIMIT_REACHED",
      "Command target sudah mencapai batas percobaan ulang.",
      false,
    );
  }

  await setDocument("radiobossCommands", targetCommandId, {
    status: "pending",
    lockedBy: null,
    lockedAt: null,
    errorCode: null,
    errorMessageSafe: null,
    updatedAt: Timestamp.now(),
  });

  return { retryTargetCommandId: targetCommandId };
}

async function executeMarkRequestPlayed(command: RadiobossCommand): Promise<Record<string, any>> {
  const requestId = getString(command.payload, "requestId");
  await setDocument("songRequests", requestId, {
    status: "played",
    playedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return { requestId, status: "played" };
}

async function executeAllowedCommand(command: RadiobossCommand): Promise<Record<string, any>> {
  if (command.type === "START_RECORDING") return executeStartRecording(command);
  if (command.type === "STOP_RECORDING") return executeStopRecording(command);
  if (command.type === "MARK_RECORDING_SKIPPED") return executeMarkSkipped(command);
  if (command.type === "ADD_TRACK_TO_QUEUE") return executeAddTrackToQueue(command);
  if (command.type === "RETRY_COMMAND") return executeRetryCommand(command);
  if (command.type === "MARK_REQUEST_PLAYED") return executeMarkRequestPlayed(command);

  throw new SafeCommandError("COMMAND_TYPE_NOT_ALLOWED", "Jenis command tidak didukung Gateway.", false);
}

export async function processPendingCommands(): Promise<void> {
  const commands = await getPendingCommands();

  for (const command of commands) {
    const locked = await tryLockCommand(command.id, gatewayId);
    if (!locked) continue;

    try {
      validateCommand(command);
      const successfulDuplicateId = await findSuccessfulCommandWithSameDedupeKey(command);
      if (successfulDuplicateId) {
        const result = {
          skippedReason: "duplicate_dedupe_key_success",
          dedupeKey: command.dedupeKey,
          duplicateCommandId: successfulDuplicateId,
        };
        await markCancelled(command.id, result);
        await writeAuditLog("command_duplicate_cancelled", command, "skipped", result);
        Logger.info(`[CommandWorker] Command duplikat dibatalkan: ${command.id}`);
        continue;
      }
      await markExecuting(command.id);
      const result = await executeAllowedCommand(command);
      await markSuccess(command.id, result);
      await writeAuditLog("command_success", command, "success", result);
      Logger.info(`[CommandWorker] Command ${command.type} sukses: ${command.id}`);
    } catch (error) {
      const safeError = toSafeCommandError(error);
      await markFailedOrRetryable(command, safeError);
      await writeAuditLog("command_failed", command, "failed", {
        errorCode: safeError.errorCode,
        errorMessageSafe: safeError.errorMessageSafe,
      });
      Logger.error(`[CommandWorker] Command ${command.type} gagal: ${safeError.errorMessageSafe}`);
    }
  }
}

let isProcessing = false;

export function startCommandWorker(): NodeJS.Timeout {
  const intervalMs = getCommandPollIntervalMs();
  Logger.info(`[CommandWorker] Aktif. Polling command setiap ${intervalMs / 1000} detik.`);

  const run = async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processPendingCommands();
    } catch (error) {
      Logger.error(`[CommandWorker] Gagal memproses antrean: ${String(error)}`);
    } finally {
      isProcessing = false;
    }
  };

  void run();
  return setInterval(run, intervalMs);
}
