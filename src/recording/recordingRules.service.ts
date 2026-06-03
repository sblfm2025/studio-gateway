import { db, runFirestoreOperation } from "../firebaseClient";
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
  const snapshot = await runFirestoreOperation(
    `get programRecordingRules/${programId}`,
    () => db.collection("programRecordingRules").doc(programId).get(),
  );
  if (!snapshot.exists) return getDefaultRecordingRule(programId);
  return {
    ...getDefaultRecordingRule(programId),
    id: snapshot.id,
    ...(snapshot.data() as Partial<ProgramRecordingRule>),
  };
}

export async function getRecordingRuleForSchedule(
  scheduleId: string,
  programId: string,
  fallbackProgramName?: string,
): Promise<ProgramRecordingRule> {
  const scheduleSnapshot = await runFirestoreOperation(
    `get programRecordingRules/${scheduleId}`,
    () => db.collection("programRecordingRules").doc(scheduleId).get(),
  );
  if (scheduleSnapshot.exists) {
    const data = scheduleSnapshot.data() as Partial<ProgramRecordingRule>;
    return {
      ...getDefaultRecordingRule(data.programId || programId),
      id: scheduleSnapshot.id,
      programName: fallbackProgramName || data.programName || programId,
      ...data,
      scheduleId: data.scheduleId || scheduleId,
    };
  }

  const programRule = await getRecordingRule(programId);
  if (programRule.programName === programRule.programId && fallbackProgramName) {
    return { ...programRule, programName: fallbackProgramName };
  }

  return programRule;
}
