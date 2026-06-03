import type { RadiobossCommandType } from "../types";

export const ALLOWED_COMMAND_TYPES: RadiobossCommandType[] = [
  "START_RECORDING",
  "STOP_RECORDING",
  "MARK_RECORDING_SKIPPED",
  "RETRY_COMMAND",
  "ADD_TRACK_TO_QUEUE",
  "MARK_REQUEST_PLAYED",
];

export function isAllowedCommandType(value: unknown): value is RadiobossCommandType {
  return typeof value === "string" && ALLOWED_COMMAND_TYPES.includes(value as RadiobossCommandType);
}
