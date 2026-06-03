import { db } from "../firebaseClient";
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
  const snapshot = await db.collection("attendanceRecords").get();

  const records = snapshot.docs
    .map((item: any) => normalizeAttendance(item.id, item.data()))
    .filter((item: NormalizedAttendance | null): item is NormalizedAttendance => Boolean(item))
    .filter((item: NormalizedAttendance) => item.date === scheduleDate)
    .filter((item: NormalizedAttendance) => matchesSchedule(item, schedule))
    .filter((item: NormalizedAttendance) => (
      (item.status === "present" || item.status === "late") &&
      item.validationStatus === "valid"
    ))
    .sort((left: NormalizedAttendance, right: NormalizedAttendance) => right.checkInAt.getTime() - left.checkInAt.getTime());

  return records[0] ?? null;
}
