import { db, Timestamp, runFirestoreOperation } from "../firebaseClient";
import type { NormalizedSchedule } from "../schedule/scheduleReader";

export type NormalizedAttendance = {
  announcerId: string;
  announcerName: string;
  date: string;
  checkInAt: Date;
  status: "present" | "late" | "absent" | "permission" | "sick";
  validationStatus: "valid" | "invalid" | "pending";
  locationValid?: boolean;
  selfieValid?: boolean;
};
let attendanceCache:
  | {
      dateKey: string;
      loadedAt: number;
      records: NormalizedAttendance[];
    }
  | null = null;

function getAttendanceCacheTtlMs(): number {
  const raw = Number(process.env.ATTENDANCE_CACHE_TTL_SECONDS || 60);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 60000;
  return Math.min(300, Math.max(15, raw)) * 1000;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeAttendance(id: string, data: Record<string, any>): NormalizedAttendance | null {
  const checkInAt = toDate(data.checkInAt);
  if (!checkInAt) return null;

  const rawStatus = String(data.status || "").toLowerCase();
  const status = rawStatus === "late" ? "late" : rawStatus === "sick" ? "sick" : rawStatus === "leave" ? "permission" : "present";
  const validationStatus = ["present", "late", "valid"].includes(rawStatus) ? "valid" : "pending";

  return {
    announcerId: data.userId || data.announcerId || id,
    announcerName: data.airName || data.displayName || data.userId || id,
    date: formatDateKey(checkInAt),
    checkInAt,
    status,
    validationStatus,
    locationValid: data.distanceToCenter === undefined || Number(data.distanceToCenter) <= 250,
    selfieValid: data.selfieUploadStatus !== "failed",
  };
}

function matchesSchedule(attendance: NormalizedAttendance, schedule: NormalizedSchedule): boolean {
  const aliases = [
    schedule.announcerId,
    schedule.announcerName,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  if (aliases.length === 0) return true;

  const attendanceValues = [
    attendance.announcerId,
    attendance.announcerName,
  ].map((value) => value.toLowerCase());

  return aliases.some((alias) => attendanceValues.some((value) => value.includes(alias) || alias.includes(value)));
}

export async function findValidAttendance(schedule: NormalizedSchedule): Promise<NormalizedAttendance | null> {
  const scheduleDate = formatDateKey(schedule.startsAt);
  const now = Date.now();
  let records: NormalizedAttendance[];

  if (attendanceCache && attendanceCache.dateKey === scheduleDate && now - attendanceCache.loadedAt < getAttendanceCacheTtlMs()) {
    records = attendanceCache.records;
  } else {
    const dayStart = startOfDay(schedule.startsAt);
    const dayEnd = addDays(dayStart, 1);
    const snapshot = await runFirestoreOperation(
      "query attendanceRecords by day",
      () => db
        .collection("attendanceRecords")
        .where("checkInAt", ">=", Timestamp.fromDate ? Timestamp.fromDate(dayStart) : dayStart)
        .where("checkInAt", "<", Timestamp.fromDate ? Timestamp.fromDate(dayEnd) : dayEnd)
        .get(),
    );

    records = snapshot.docs
      .map((item: any) => normalizeAttendance(item.id, item.data()))
      .filter((item: NormalizedAttendance | null): item is NormalizedAttendance => Boolean(item))
      .filter((item: NormalizedAttendance) => item.date === scheduleDate);
    attendanceCache = {
      dateKey: scheduleDate,
      loadedAt: now,
      records,
    };
  }

  return records
    .filter((item: NormalizedAttendance) => matchesSchedule(item, schedule))
    .filter((item: NormalizedAttendance) => (
      (item.status === "present" || item.status === "late") &&
      item.validationStatus === "valid"
    ))
    .sort((left: NormalizedAttendance, right: NormalizedAttendance) => right.checkInAt.getTime() - left.checkInAt.getTime())[0] ?? null;
}
