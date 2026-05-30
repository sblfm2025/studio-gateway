import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const logFilePath = path.resolve(
  process.cwd(),
  process.env.LOG_FILE || "gateway.log",
);
const maxMb = Number(process.env.LOG_MAX_SIZE_MB || 5);
const maxBytes = maxMb * 1024 * 1024;

export class Logger {
  // Melakukan pengecekan dan merotasi berkas log jika melebihi ukuran maksimum
  private static rotateIfNeeded() {
    try {
      if (!fs.existsSync(logFilePath)) return;

      const stat = fs.statSync(logFilePath);
      if (stat.size < maxBytes) return;

      const oldPath = logFilePath.replace(/\.log$/, ".old.log");

      // Hapus file log lama cadangan jika sudah ada
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }

      // Rename log aktif menjadi log cadangan
      fs.renameSync(logFilePath, oldPath);
    } catch (err) {
      console.error("[Logger] Gagal melakukan rotasi berkas log:", err);
    }
  }

  // Menyensor data sensitif (seperti password) agar tidak masuk berkas log
  private static sanitizeMessage(message: string): string {
    const password = process.env.RADIOBOSS_API_PASSWORD;
    if (!password || password.trim() === "") return message;

    // Ganti seluruh kemunculan password sensitif dengan kata sensor [REDACTED]
    // Menangani pencarian global yang aman tanpa error regex
    const escapedPassword = password.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(escapedPassword, "g");
    return message.replace(regex, "[REDACTED_PASSWORD]");
  }

  private static formatMessage(
    message: string,
    level: "INFO" | "WARN" | "ERROR",
  ): string {
    const timestamp = new Date().toISOString();
    const sanitized = this.sanitizeMessage(message);
    return `[${timestamp}] [${level}] ${sanitized}`;
  }

  static log(message: string, level: "INFO" | "WARN" | "ERROR" = "INFO") {
    const formatted = this.formatMessage(message, level);

    // Tampilkan di konsol standar
    if (level === "ERROR") {
      console.error(formatted);
    } else if (level === "WARN") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    // Tulis ke berkas log setelah melakukan rotasi jika diperlukan
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(logFilePath, formatted + "\n", "utf8");
    } catch (err) {
      console.error("[Logger] Gagal menulis ke berkas log lokal:", err);
    }
  }

  static info(message: string) {
    this.log(message, "INFO");
  }

  static warn(message: string) {
    this.log(message, "WARN");
  }

  static error(message: string) {
    this.log(message, "ERROR");
  }
}
export default Logger;
