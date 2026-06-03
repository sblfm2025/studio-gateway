import { db } from "../firebaseClient";
import type { ProgramRecordingRule } from "../types";

export function getDefaultRecordingRule(programId: string): ProgramRecordingRule {
  return {
    programId,
    programName: programId,
    recordingEnabled: false,
    requireAttendance: true,
    autoStart: false,
    autoStop: true,
    allowManualOverride: true,
    startGraceMinutes: 15,
    stopGraceMinutes: 10,
    maxOverrunMinutes: 30,
    minDurationMinutes: 5,
    folderSlug: programId,
    format: "mp3",
    storageRootKey: "RADIO_SBL_RECORDING_ROOT",
  };
}

export async function getRecordingRule(programId: string): Promise<ProgramRecordingRule> {
  const snapshot = await db.collection("programRecordingRules").doc(programId).get();
  if (!snapshot.exists) return getDefaultRecordingRule(programId);
  return { ...getDefaultRecordingRule(programId), ...(snapshot.data() as Partial<ProgramRecordingRule>) };
}
