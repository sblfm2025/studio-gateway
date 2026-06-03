import { db } from "../firebaseClient";

export type NormalizedSchedule = {
  scheduleId: string;
  programId: string;
  programName: string;
  announcerId?: string;
  announcerName?: string;
  startsAt: Date;
  endsAt: Date;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSchedule(id: string, data: Record<string, any>): NormalizedSchedule | null {
  const startsAt = toDate(data.startsAt);
  const endsAt = toDate(data.endsAt);
  if (!startsAt || !endsAt) return null;

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

export async function getSchedulesNearNow(now = new Date()): Promise<NormalizedSchedule[]> {
  const windowBeforeMs = 2 * 60 * 60 * 1000;
  const windowAfterMs = 4 * 60 * 60 * 1000;
  const minTime = now.getTime() - windowBeforeMs;
  const maxTime = now.getTime() + windowAfterMs;

  const snapshot = await db.collection("broadcastSchedules").get();

  return snapshot.docs
    .map((item: any) => normalizeSchedule(item.id, item.data()))
    .filter((schedule: NormalizedSchedule | null): schedule is NormalizedSchedule => Boolean(schedule))
    .filter((schedule: NormalizedSchedule) => (
      schedule.endsAt.getTime() >= minTime &&
      schedule.startsAt.getTime() <= maxTime
    ));
}
