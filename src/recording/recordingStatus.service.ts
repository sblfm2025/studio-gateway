import { recordingDb, Timestamp, setRecordingDocument, runFirestoreOperation } from "../firebaseClient";
import type { ProgramRecording, RecordingStatus } from "../types";

export async function upsertProgramRecording(recordingId: string, data: Partial<ProgramRecording>): Promise<void> {
  await setRecordingDocument("programRecordings", recordingId, {
    ...data,
    recordingId,
    updatedAt: Timestamp.now(),
    createdAt: data.createdAt || Timestamp.now(),
  });
}

function toComparable(value: any): any {
  if (!value) return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return value;
}

function hasMeaningfulChange(
  current: ProgramRecording | null,
  patch: Partial<ProgramRecording>,
): boolean {
  if (!current) return true;

  return Object.entries(patch).some(([key, value]) => {
    if (key === "updatedAt" || key === "createdAt") return false;
    return toComparable((current as any)[key]) !== toComparable(value);
  });
}

export async function upsertProgramRecordingIfChanged(
  recordingId: string,
  current: ProgramRecording | null,
  data: Partial<ProgramRecording>,
): Promise<boolean> {
  const patch = {
    ...data,
    recordingId,
  };

  if (!hasMeaningfulChange(current, patch)) return false;

  await upsertProgramRecording(recordingId, data);
  return true;
}

export async function getProgramRecording(recordingId: string): Promise<ProgramRecording | null> {
  const snapshot = await runFirestoreOperation(
    `get programRecordings/${recordingId}`,
    () => recordingDb.collection("programRecordings").doc(recordingId).get(),
  );
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...(snapshot.data() as Omit<ProgramRecording, "id">) };
}

export async function updateRecordingStatus(
  recordingId: string,
  status: RecordingStatus,
  patch: Partial<ProgramRecording> = {},
): Promise<void> {
  await setRecordingDocument("programRecordings", recordingId, {
    ...patch,
    status,
    updatedAt: Timestamp.now(),
  });
}
