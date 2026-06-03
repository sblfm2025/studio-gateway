export class SafeCommandError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly errorMessageSafe: string,
    public readonly retryable = false,
  ) {
    super(errorMessageSafe);
  }
}

export function toSafeCommandError(error: unknown): SafeCommandError {
  if (error instanceof SafeCommandError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("timeout") || lower.includes("abort")) {
    return new SafeCommandError(
      "RADIOBOSS_TIMEOUT",
      "Command ke RadioBOSS timeout. Gateway akan dapat mencoba ulang.",
      true,
    );
  }

  if (lower.includes("econnrefused") || lower.includes("fetch failed")) {
    return new SafeCommandError(
      "RADIOBOSS_OFFLINE",
      "RadioBOSS tidak terhubung. Pastikan RadioBOSS berjalan dan API lokal aktif.",
      true,
    );
  }

  return new SafeCommandError(
    "COMMAND_EXECUTION_FAILED",
    "Command gagal dieksekusi Gateway. Periksa log Gateway di PC studio.",
    false,
  );
}
