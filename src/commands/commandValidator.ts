import type { RadiobossCommand } from "../types";
import { isAllowedCommandType } from "./safeCommandAllowlist";
import { SafeCommandError } from "./commandTypes";

function requireString(payload: Record<string, any>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new SafeCommandError(
      "INVALID_COMMAND_PAYLOAD",
      `Payload command tidak lengkap: ${field} wajib diisi.`,
      false,
    );
  }
  return value.trim();
}

export function validateCommand(command: RadiobossCommand): void {
  if (!isAllowedCommandType(command.type)) {
    throw new SafeCommandError(
      "COMMAND_TYPE_NOT_ALLOWED",
      "Jenis command tidak masuk allowlist Gateway.",
      false,
    );
  }

  if (!command.payload || typeof command.payload !== "object") {
    throw new SafeCommandError(
      "INVALID_COMMAND_PAYLOAD",
      "Payload command tidak valid.",
      false,
    );
  }

  if ("rawCommand" in command || "rawCommand" in command.payload) {
    throw new SafeCommandError(
      "RAW_COMMAND_FORBIDDEN",
      "Raw command RadioBOSS tidak diizinkan.",
      false,
    );
  }

  if (command.type === "START_RECORDING") {
    requireString(command.payload, "programId");
    requireString(command.payload, "scheduleId");
  }

  if (command.type === "STOP_RECORDING") {
    requireString(command.payload, "recordingId");
  }

  if (command.type === "MARK_RECORDING_SKIPPED") {
    requireString(command.payload, "programId");
    requireString(command.payload, "scheduleId");
  }

  if (command.type === "RETRY_COMMAND") {
    requireString(command.payload, "commandId");
  }

  if (command.type === "ADD_TRACK_TO_QUEUE") {
    requireString(command.payload, "requestId");
    requireString(command.payload, "filePath");
  }
}
