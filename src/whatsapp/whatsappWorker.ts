import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { exec } from "child_process";
import type { WASocket } from "@whiskeysockets/baileys";
import { Logger } from "../logger";
import { parseWhatsAppSongRequest } from "./whatsappParser";
import { checkWhatsAppRateLimit, registerWhatsAppRequest } from "./whatsappRateLimit";
import { saveWhatsAppSongRequest } from "./whatsappFirestore.service";

type BaileysModule = typeof import("@whiskeysockets/baileys");
type WhatsAppSocket = WASocket;

const qrcode = require("qrcode-terminal") as {
  generate: (input: string, options?: { small?: boolean }) => void;
};

const QRCode = require("qrcode") as {
  toDataURL: (input: string) => Promise<string>;
};

let started = false;
let reconnectTimer: NodeJS.Timeout | null = null;

const QR_TEMP_PREFIX = "wa-qr-";
function getQrTtlMs(): number {
  const raw = Number(process.env.WHATSAPP_QR_TTL_SECONDS || 300);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 300000;
  return Math.max(30, raw) * 1000;
}

// Hapus file HTML QR lama yang lebih tua dari TTL * 2 pada startup
function cleanupOldQrFiles() {
  try {
    const dir = os.tmpdir();
    const files = fs.readdirSync(dir);
    const now = Date.now();
    const ttl = getQrTtlMs();
    for (const f of files) {
      if (!f.startsWith(QR_TEMP_PREFIX) || !f.endsWith(".html")) continue;
      try {
        const p = path.join(dir, f);
        const stat = fs.statSync(p);
        if (now - stat.mtimeMs > ttl * 2) {
          fs.unlinkSync(p);
          Logger.info(`[WhatsAppWorker] Menghapus QR HTML lama: ${p}`);
        }
      } catch (err) {
        // ignore per-file errors
      }
    }
  } catch (err) {
    Logger.warn(`[WhatsAppWorker] Gagal membersihkan file QR lama: ${String(err)}`);
  }
}

function getStartDelayMs(): number {
  const raw = Number(process.env.WHATSAPP_WORKER_START_DELAY_SECONDS || 60);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 60000;
  return Math.max(0, raw) * 1000;
}

function getSessionDir(): string {
  const raw = process.env.WHATSAPP_SESSION_DIR || "./wa-session";
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function shouldIgnoreGroups(): boolean {
  return process.env.WHATSAPP_IGNORE_GROUPS !== "false";
}

function shouldAutoReply(): boolean {
  return process.env.WHATSAPP_AUTO_REPLY_ENABLED !== "false";
}

async function loadBaileys(): Promise<BaileysModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<BaileysModule>;
  return dynamicImport("@whiskeysockets/baileys");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMessageText(message: any): string {
  if (!message) return "";
  if (message.conversation) return String(message.conversation);
  if (message.extendedTextMessage?.text) return String(message.extendedTextMessage.text);
  if (message.imageMessage?.caption) return String(message.imageMessage.caption);
  if (message.videoMessage?.caption) return String(message.videoMessage.caption);
  if (message.documentMessage?.caption) return String(message.documentMessage.caption);
  if (message.ephemeralMessage?.message) return extractMessageText(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return extractMessageText(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return extractMessageText(message.viewOnceMessageV2.message);
  return "";
}

function extractPhone(remoteJid: string): string {
  return remoteJid.split("@")[0]?.replace(/\D/g, "") || remoteJid;
}

function isGroupJid(remoteJid: string): boolean {
  return remoteJid.endsWith("@g.us");
}

function shortenLogText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function shouldReconnect(statusCode: number | undefined, disconnectReason: any): boolean {
  return statusCode !== disconnectReason.loggedOut;
}

async function handleIncomingMessage(sock: WhatsAppSocket, message: any): Promise<void> {
  let remoteJid = "";
  try {
    remoteJid = message.key?.remoteJid || "";
    if (!remoteJid || remoteJid === "status@broadcast") return;
    if (message.key?.fromMe) return;
    if (shouldIgnoreGroups() && isGroupJid(remoteJid)) return;

    const text = extractMessageText(message.message).trim();
    const parsed = parseWhatsAppSongRequest(text);
    if (!parsed.isRequest) {
      Logger.info(
        `[WhatsAppWorker] Pesan diabaikan (${parsed.ignoredReason || "not_request"}): "${shortenLogText(text)}"`,
      );
      return;
    }

    const phone = extractPhone(remoteJid);
    const limit = checkWhatsAppRateLimit(phone);
    if (!limit.allowed) {
      Logger.warn(`[WhatsAppWorker] Rate limit tercapai untuk ${phone}. Pesan diabaikan.`);
      if (shouldAutoReply()) {
        await sock.sendMessage(remoteJid, {
          text: "Mohon maaf, request lagu dari nomor ini sudah mencapai batas sementara. Silakan coba lagi nanti.",
        });
      }
      return;
    }

    const requestId = await saveWhatsAppSongRequest({
      ...parsed,
      requesterName: message.pushName || "Pendengar WhatsApp",
      requesterPhone: phone,
      whatsappMessageId: message.key?.id,
    });
    registerWhatsAppRequest(phone);
    Logger.info(`[WhatsAppWorker] Request lagu WhatsApp tersimpan: ${requestId}`);

    if (shouldAutoReply()) {
      await sock.sendMessage(remoteJid, {
        text: "Terima kasih. Request lagu Anda sudah masuk ke Radio SBL dan akan direview penyiar.",
      });
    }
  } catch (error) {
    Logger.error(`[WhatsAppWorker] Gagal memproses pesan masuk: ${String(error)}`);
    if (remoteJid && shouldAutoReply()) {
      try {
        await sock.sendMessage(remoteJid, {
          text: "Mohon maaf, request lagu Anda belum berhasil dicatat oleh sistem Radio SBL. Silakan coba lagi beberapa saat lagi.",
        });
      } catch (replyError) {
        Logger.warn(`[WhatsAppWorker] Gagal mengirim balasan error WhatsApp: ${String(replyError)}`);
      }
    }
  }
}

async function connectWhatsApp(): Promise<void> {
  const baileys = await loadBaileys();
  const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers } = baileys;
  const { state, saveCreds } = await useMultiFileAuthState(getSessionDir());
  const sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS("Radio SBL Studio Gateway"),
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (update: any) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      Logger.info("[WhatsAppWorker] Scan QR berikut dengan WhatsApp Business di PC Studio:");
      qrcode.generate(qr, { small: true });
      // Tampilkan QR di browser agar tetap terlihat meskipun proses utama berjalan tersembunyi
      void (async () => {
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          const html = `<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp QR</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff;font-family:Arial,Helvetica"><div style="text-align:center"><h2>Scan QR WhatsApp Business</h2><img src="${dataUrl}" alt="QR Code" style="width:320px;height:320px;object-fit:contain;background:#fff;padding:8px;border-radius:8px"/><p style="opacity:0.8">Tutup tab setelah selesai.</p></div></body></html>`;
          const tmpPath = path.join(os.tmpdir(), `wa-qr-${Date.now()}.html`);
          fs.writeFileSync(tmpPath, html, "utf8");
          // Create a marker file so external watchers can detect QR event
          try {
            const markerPath = path.join(os.tmpdir(), `wa-qr-${Date.now()}.flag`);
            fs.writeFileSync(markerPath, tmpPath, "utf8");
            // schedule marker removal with same TTL
            setTimeout(() => {
              try {
                if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
              } catch (e) {}
            }, getQrTtlMs());
          } catch (e) {
            // ignore marker write errors
          }

          const opener = process.platform === "win32"
            ? `start "" "${tmpPath.replace(/"/g, '\\"')}"`
            : process.platform === "darwin"
              ? `open "${tmpPath.replace(/"/g, '\\"')}"`
              : `xdg-open "${tmpPath.replace(/"/g, '\\"')}"`;

          exec(opener, (err) => {
            if (err) Logger.warn(`[WhatsAppWorker] Gagal membuka QR di browser: ${String(err)}`);
            else Logger.info(`[WhatsAppWorker] QR ditampilkan di browser: ${tmpPath}`);
          });
            // Schedule automatic deletion of temporary file
            const ttl = getQrTtlMs();
            setTimeout(() => {
              try {
                if (fs.existsSync(tmpPath)) {
                  fs.unlinkSync(tmpPath);
                  Logger.info(`[WhatsAppWorker] QR HTML otomatis dihapus: ${tmpPath}`);
                }
              } catch (err) {
                Logger.warn(`[WhatsAppWorker] Gagal menghapus file QR sementara: ${String(err)}`);
              }
            }, ttl);
        } catch (err) {
          Logger.warn(`[WhatsAppWorker] Gagal menghasilkan QR image: ${String(err)}`);
        }
      })();
    }

    if (connection === "open") {
      Logger.info("[WhatsAppWorker] WhatsApp terhubung.");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (shouldReconnect(statusCode, DisconnectReason)) {
        Logger.warn(`[WhatsAppWorker] Koneksi WhatsApp tertutup (${statusCode || "unknown"}). Mencoba ulang dalam 10 detik.`);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          connectWhatsApp().catch((error) => Logger.error(`[WhatsAppWorker] Reconnect gagal: ${String(error)}`));
        }, 10000);
      } else {
        Logger.error("[WhatsAppWorker] Sesi WhatsApp logout. Hapus wa-session jika perlu login ulang.");
      }
    }
  });

  sock.ev.on("messages.upsert", (event: any) => {
    for (const message of event.messages || []) {
      void handleIncomingMessage(sock, message);
    }
  });
}

export async function startWhatsAppRequestWorker(): Promise<void> {
  if (process.env.WHATSAPP_REQUEST_WORKER_ENABLED !== "true") {
    Logger.info("[WhatsAppWorker] Nonaktif. Set WHATSAPP_REQUEST_WORKER_ENABLED=true untuk mengaktifkan.");
    return;
  }

  if (started) return;
  started = true;

  const delayMs = getStartDelayMs();
  Logger.info(`[WhatsAppWorker] Aktif. Menunggu ${delayMs / 1000} detik sebelum koneksi WhatsApp.`);
  await sleep(delayMs);

  try {
    await connectWhatsApp();
  } catch (error) {
    Logger.error(`[WhatsAppWorker] Gagal memulai worker: ${String(error)}`);
  }
}
