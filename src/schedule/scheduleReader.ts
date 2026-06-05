import { db, runFirestoreOperation } from "../firebaseClient";

export type NormalizedSchedule = {
  scheduleId: string;
  programId: string;
  programName: string;
  announcerId?: string;
  announcerName?: string;
  startsAt: Date;
  endsAt: Date;
};

type WeeklyScheduleSlot = {
  id?: string;
  day: string;
  time: string;
  program: string;
  description?: string;
  announcer?: string;
  isCancelled?: boolean;
};

type ScheduleOverride = {
  id?: string;
  date: string;
  slotId: string;
  type: "replace" | "add" | "cancel" | "reschedule" | "activate_optional";
  newProgram?: string;
  newAnnouncer?: string;
  newTime?: string;
  description?: string;
  reason?: string;
};

const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
let scheduleCache:
  | {
      loadedAt: number;
      broadcastSchedules: NormalizedSchedule[];
      weeklySlots: WeeklyScheduleSlot[];
      overrides: ScheduleOverride[];
    }
  | null = null;

function getScheduleCacheTtlMs(): number {
  const raw = Number(process.env.SCHEDULE_CACHE_TTL_SECONDS || 120);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 120000;
  return Math.min(600, Math.max(30, raw)) * 1000;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getDayName(date: Date): string {
  return dayNames[date.getDay()];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getScheduleSlotId(slot: Pick<WeeklyScheduleSlot, "day" | "time" | "program">): string {
  return [
    slugify(slot.day),
    slugify(slot.time.replace(/\s+/g, "")),
    slugify(slot.program),
  ].filter(Boolean).join("-");
}

function parseClock(value: string): number {
  const [hour, minute] = value.trim().replace(".", ":").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Number.NaN;
  return hour * 60 + minute;
}

function parseTimeRangeMinutes(time: string): { start: number; end: number } {
  const [startText, endText] = String(time || "").split("-");
  return {
    start: parseClock(startText || ""),
    end: parseClock(endText || ""),
  };
}

function buildDateAtMinutes(date: Date, minutes: number): Date {
  const next = new Date(date);
  next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return next;
}

function normalizeBroadcastSchedule(id: string, data: Record<string, any>): NormalizedSchedule | null {
  const startsAt = toDate(data.startsAt);
  const endsAt = toDate(data.endsAt);
  if (!startsAt || !endsAt || data.status === "cancelled") return null;

  return {
    scheduleId: data.id || id,
    programId: data.programId || data.programName || data.programTitle || id,
    programName: data.programName || data.programTitle || data.programId || "Program Radio SBL",
    announcerId: data.announcerId || data.announcerIds?.[0],
    announcerName: data.announcerName || data.hostName || data.announcerId || data.announcerIds?.[0],
    startsAt,
    endsAt,
  };
}

function normalizeWeeklySlot(id: string, data: Record<string, any>): WeeklyScheduleSlot | null {
  if (!data.day || !data.time || !data.program) return null;
  return {
    id: data.id || id,
    day: String(data.day),
    time: String(data.time),
    program: String(data.program),
    description: data.description,
    announcer: data.announcer,
    isCancelled: Boolean(data.isCancelled),
  };
}

function normalizeOverride(id: string, data: Record<string, any>): ScheduleOverride | null {
  if (!data.date || !data.slotId || !data.type) return null;
  return {
    id,
    date: String(data.date),
    slotId: String(data.slotId),
    type: data.type,
    newProgram: data.newProgram,
    newAnnouncer: data.newAnnouncer,
    newTime: data.newTime,
    description: data.description,
    reason: data.reason,
  };
}

function applyOverrides(slots: WeeklyScheduleSlot[], overrides: ScheduleOverride[], date: Date): WeeklyScheduleSlot[] {
  const dateKey = formatDateKey(date);
  const day = getDayName(date);
  const byId = new Map(slots.map((slot) => [slot.id || getScheduleSlotId(slot), { ...slot }]));

  for (const override of overrides.filter((item) => item.date === dateKey)) {
    const existing = byId.get(override.slotId);

    if (override.type === "add") {
      byId.set(override.slotId, {
        id: override.slotId,
        day,
        time: override.newTime || "00.00 - 00.00",
        program: override.newProgram || "Program Khusus",
        description: override.description || override.reason,
        announcer: override.newAnnouncer || "Radio SBL",
      });
      continue;
    }

    if (!existing) continue;

    if (override.type === "cancel") {
      byId.set(override.slotId, { ...existing, isCancelled: true });
      continue;
    }

    byId.set(override.slotId, {
      ...existing,
      time: override.newTime || existing.time,
      program: override.newProgram || existing.program,
      announcer: override.newAnnouncer || existing.announcer,
      description: override.description || existing.description,
    });
  }

  return Array.from(byId.values()).filter((slot) => !slot.isCancelled);
}

function weeklySlotToSchedule(slot: WeeklyScheduleSlot, date: Date): NormalizedSchedule | null {
  const { start, end } = parseTimeRangeMinutes(slot.time);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  const startsAt = buildDateAtMinutes(date, start);
  const endsAt = buildDateAtMinutes(date, end);
  if (end <= start) {
    endsAt.setDate(endsAt.getDate() + 1);
  }

  const scheduleId = slot.id || getScheduleSlotId(slot);
  return {
    scheduleId,
    programId: slugify(slot.program) || scheduleId,
    programName: slot.program,
    announcerId: slot.announcer,
    announcerName: slot.announcer,
    startsAt,
    endsAt,
  };
}

async function getBroadcastSchedules(): Promise<NormalizedSchedule[]> {
  const snapshot = await runFirestoreOperation(
    "query broadcastSchedules",
    () => db.collection("broadcastSchedules").get(),
  );
  return snapshot.docs
    .map((item: any) => normalizeBroadcastSchedule(item.id, item.data()))
    .filter((schedule: NormalizedSchedule | null): schedule is NormalizedSchedule => Boolean(schedule));
}

async function getWeeklyScheduleSlots(): Promise<WeeklyScheduleSlot[]> {
  const snapshot = await runFirestoreOperation(
    "query weekly_schedule_slots",
    () => db.collection("weekly_schedule_slots").get(),
  );
  return snapshot.docs
    .map((item: any) => normalizeWeeklySlot(item.id, item.data()))
    .filter((slot: WeeklyScheduleSlot | null): slot is WeeklyScheduleSlot => Boolean(slot));
}

async function getScheduleOverrides(): Promise<ScheduleOverride[]> {
  const snapshot = await runFirestoreOperation(
    "query scheduleOverrides",
    () => db.collection("scheduleOverrides").get(),
  );
  return snapshot.docs
    .map((item: any) => normalizeOverride(item.id, item.data()))
    .filter((override: ScheduleOverride | null): override is ScheduleOverride => Boolean(override));
}

async function getCachedScheduleSources(): Promise<{
  broadcastSchedules: NormalizedSchedule[];
  weeklySlots: WeeklyScheduleSlot[];
  overrides: ScheduleOverride[];
}> {
  const now = Date.now();
  if (scheduleCache && now - scheduleCache.loadedAt < getScheduleCacheTtlMs()) {
    return scheduleCache;
  }

  const [broadcastSchedules, weeklySlots, overrides] = await Promise.all([
    getBroadcastSchedules(),
    getWeeklyScheduleSlots(),
    getScheduleOverrides(),
  ]);

  scheduleCache = {
    loadedAt: now,
    broadcastSchedules,
    weeklySlots,
    overrides,
  };
  return scheduleCache;
}

function datesNear(now: Date): Date[] {
  return [-1, 0, 1].map((offset) => {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    return date;
  });
}

function isNearWindow(schedule: NormalizedSchedule, minTime: number, maxTime: number): boolean {
  return schedule.endsAt.getTime() >= minTime && schedule.startsAt.getTime() <= maxTime;
}

export async function getSchedulesNearNow(now = new Date()): Promise<NormalizedSchedule[]> {
  const windowBeforeMs = 2 * 60 * 60 * 1000;
  const windowAfterMs = 4 * 60 * 60 * 1000;
  const minTime = now.getTime() - windowBeforeMs;
  const maxTime = now.getTime() + windowAfterMs;

  const { broadcastSchedules, weeklySlots, overrides } = await getCachedScheduleSources();
  const nearBroadcastSchedules = broadcastSchedules.filter((schedule) => isNearWindow(schedule, minTime, maxTime));

  if (weeklySlots.length === 0) {
    return nearBroadcastSchedules;
  }

  const recurringSchedules = datesNear(now).flatMap((date) => {
    const daySlots = weeklySlots.filter((slot) => slot.day === getDayName(date));
    return applyOverrides(daySlots, overrides, date)
      .map((slot) => weeklySlotToSchedule(slot, date))
      .filter((schedule: NormalizedSchedule | null): schedule is NormalizedSchedule => Boolean(schedule));
  });

  const byKey = new Map<string, NormalizedSchedule>();
  [...recurringSchedules, ...nearBroadcastSchedules]
    .filter((schedule) => isNearWindow(schedule, minTime, maxTime))
    .forEach((schedule) => {
      byKey.set(`${schedule.scheduleId}_${formatDateKey(schedule.startsAt)}`, schedule);
    });

  return Array.from(byKey.values()).sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}
