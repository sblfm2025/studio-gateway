import * as path from "path";
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

let started = false;
let reconnectTimer: NodeJS.Timeout | null = null;

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

function shouldReconnect(statusCode: number | undefined, disconnectReason: any): boolean {
  return statusCode !== disconnectReason.loggedOut;
}

async function handleIncomingMessage(sock: WhatsAppSocket, message: any): Promise<void> {
  try {
    const remoteJid = message.key?.remoteJid;
    if (!remoteJid || remoteJid === "status@broadcast") return;
    if (message.key?.fromMe) return;
    if (shouldIgnoreGroups() && isGroupJid(remoteJid)) return;

    const text = extractMessageText(message.message).trim();
    const parsed = parseWhatsAppSongRequest(text);
    if (!parsed.isRequest) return;

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
