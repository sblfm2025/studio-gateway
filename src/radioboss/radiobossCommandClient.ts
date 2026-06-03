import dotenv from "dotenv";
import { SafeCommandError } from "../commands/commandTypes";

dotenv.config();

const apiUrlRaw = process.env.RADIOBOSS_API_URL;
const apiPassword = process.env.RADIOBOSS_API_PASSWORD;

function getTimeoutMs(): number {
  const raw = Number(process.env.RADIOBOSS_TIMEOUT_MS || 5000);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 5000;
  return Math.min(15000, Math.max(1000, raw));
}

export async function sendAllowedRadioBossCommand(command: string): Promise<string> {
  if (!apiUrlRaw || !apiPassword) {
    throw new SafeCommandError(
      "RADIOBOSS_CONFIG_MISSING",
      "Konfigurasi API RadioBOSS belum lengkap di Gateway.",
      false,
    );
  }

  const url = new URL(apiUrlRaw);
  url.searchParams.set("pass", apiPassword);
  url.searchParams.set("action", "command");
  url.searchParams.set("cmd", command);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    const text = await response.text();

    if (!response.ok) {
      throw new SafeCommandError(
        "RADIOBOSS_COMMAND_HTTP_ERROR",
        "RadioBOSS menolak command atau memberi respons error.",
        true,
      );
    }

    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendRadioBossAction(
  action: string,
  params: Record<string, string>,
): Promise<string> {
  if (!apiUrlRaw || !apiPassword) {
    throw new SafeCommandError(
      "RADIOBOSS_CONFIG_MISSING",
      "Konfigurasi API RadioBOSS belum lengkap di Gateway.",
      false,
    );
  }

  const url = new URL(apiUrlRaw);
  url.searchParams.set("pass", apiPassword);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    const text = await response.text();

    if (!response.ok || /^error\b/i.test(text.trim())) {
      throw new SafeCommandError(
        "RADIOBOSS_ACTION_HTTP_ERROR",
        "RadioBOSS menolak action atau memberi respons error.",
        true,
      );
    }

    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}
