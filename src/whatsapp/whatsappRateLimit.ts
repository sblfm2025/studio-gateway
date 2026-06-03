import type { WhatsAppRateLimitResult } from "./whatsappTypes";

const requestCache = new Map<string, number[]>();
const oneHourMs = 60 * 60 * 1000;

function getMaxRequestsPerHour(): number {
  const raw = Number(process.env.WHATSAPP_MAX_REQUEST_PER_PHONE_PER_HOUR || 3);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 3;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

export function checkWhatsAppRateLimit(phone: string, now = Date.now()): WhatsAppRateLimitResult {
  const max = getMaxRequestsPerHour();
  const recent = (requestCache.get(phone) || []).filter((timestamp) => now - timestamp < oneHourMs);
  const oldest = recent[0] || now;

  return {
    allowed: recent.length < max,
    remaining: Math.max(0, max - recent.length),
    resetAt: oldest + oneHourMs,
  };
}

export function registerWhatsAppRequest(phone: string, now = Date.now()): WhatsAppRateLimitResult {
  const recent = (requestCache.get(phone) || []).filter((timestamp) => now - timestamp < oneHourMs);
  recent.push(now);
  requestCache.set(phone, recent);
  return checkWhatsAppRateLimit(phone, now);
}
