import { db, Timestamp, setDocument } from "../firebaseClient";
import type { ProgramRecording, RecordingStatus } from "../types";

export async function upsertProgramRecording(recordingId: string, data: Partial<ProgramRecording>): Promise<void> {
  await setDocument("programRecordings", recordingId, {
    ...data,
    recordingId,
    updatedAt: Timestamp.now(),
    createdAt: data.createdAt || Timestamp.now(),
  });
}

export async function getProgramRecording(recordingId: string): Promise<ProgramRecording | null> {
  const snapshot = await db.collection("programRecordings").doc(recordingId).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...(snapshot.data() as Omit<ProgramRecording, "id">) };
}

export async function updateRecordingStatus(
  recordingId: string,
  status: RecordingStatus,
  patch: Partial<ProgramRecording> = {},
): Promise<void> {
  await setDocument("programRecordings", recordingId, {
    ...patch,
    status,
    updatedAt: Timestamp.now(),
  });
}
