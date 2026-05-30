import dotenv from "dotenv";
import { Logger } from "./logger";

dotenv.config();

const apiUrlRaw = process.env.RADIOBOSS_API_URL;
const apiPassword = process.env.RADIOBOSS_API_PASSWORD;

// Validasi Konfigurasi Startup Klien RadioBOSS
if (!apiUrlRaw || !apiPassword) {
  const missing = [];
  if (!apiUrlRaw) missing.push("RADIOBOSS_API_URL");
  if (!apiPassword) missing.push("RADIOBOSS_API_PASSWORD");
  Logger.error(
    `[Config] Gagal memulai agen. Variabel berikut wajib terisi di .env: ${missing.join(", ")}`,
  );
  process.exit(1);
}

// Validasi format URL API
try {
  new URL(apiUrlRaw);
} catch (err) {
  Logger.error(
    `[Config] Format RADIOBOSS_API_URL tidak valid: "${apiUrlRaw}". Harap gunakan format seperti http://127.0.0.1:9001`,
  );
  process.exit(1);
}

// Ambil dan validasi batas waktu respons (Timeout)
function getTimeoutMs(): number {
  const raw = Number(process.env.RADIOBOSS_TIMEOUT_MS || 5000);
  if (!Number.isFinite(raw) || isNaN(raw)) {
    return 5000; // Default 5 detik
  }
  // Batas aman: minimal 1000 ms, maksimal 15000 ms
  return Math.min(15000, Math.max(1000, raw));
}

const timeoutMs = getTimeoutMs();

export async function fetchPlaybackInfoFromRadioBoss(): Promise<string> {
  const url = new URL(apiUrlRaw!);
  // Encode parameter URL secara aman menggunakan URLSearchParams
  url.searchParams.set("pass", apiPassword!);
  url.searchParams.set("action", "playbackinfo");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RadioBOSS API HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    return text;
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error(
        `Koneksi ke RadioBOSS API melampaui batas waktu (${timeoutMs / 1000} detik).`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
