import type { WhatsAppRequestParseResult } from "./whatsappTypes";

const defaultKeywords = ["req", "request", "lagu", "putarkan", "minta lagu", "kirim lagu"];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value = ""): string {
  return value
    .replace(/^[:\s\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getAllowedKeywords(): string[] {
  const raw = process.env.WHATSAPP_ALLOWED_KEYWORDS || defaultKeywords.join(",");
  return raw
    .split(",")
    .map((item) => normalize(item))
    .filter(Boolean);
}

function containsKeyword(text: string, keywords: string[]): boolean {
  const normalized = normalize(text);
  return keywords.some((keyword) => new RegExp(`(^|\\b)${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|$)`, "i").test(normalized));
}

function stripRequestPrefix(text: string): { text: string; keyword?: string; artistFirst: boolean } {
  const rules = [
    { keyword: "minta lagu", pattern: /^(minta\s+lagu)\b[:\s-]*/i, artistFirst: false },
    { keyword: "kirim lagu", pattern: /^(kirim\s+lagu)\b[:\s-]*/i, artistFirst: false },
    { keyword: "request lagu", pattern: /^(request\s+lagu)\b[:\s-]*/i, artistFirst: false },
    { keyword: "putarkan", pattern: /^(putarkan)\b[:\s-]*/i, artistFirst: false },
    { keyword: "req", pattern: /^(req)\b[:\s-]*/i, artistFirst: false },
    { keyword: "request", pattern: /^(request)\b[:\s-]*/i, artistFirst: true },
    { keyword: "lagu", pattern: /^(lagu)\b[:\s-]*/i, artistFirst: false },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      return {
        text: clean(text.replace(rule.pattern, "")),
        keyword: rule.keyword,
        artistFirst: rule.artistFirst,
      };
    }
  }

  return { text: clean(text), artistFirst: false };
}

function splitDedication(text: string): { requestText: string; dedication?: string } {
  const match = text.match(/\s+(untuk|buat|kepada)\s+(.+)$/i);
  if (!match || match.index === undefined) {
    return { requestText: clean(text) };
  }

  return {
    requestText: clean(text.slice(0, match.index)),
    dedication: clean(match[2]),
  };
}

function parseDashFormat(text: string, artistFirst: boolean): Pick<WhatsAppRequestParseResult, "requestedTitle" | "requestedArtist" | "confidence"> | null {
  const parts = text.split(/\s+[-–—]\s+/).map(clean).filter(Boolean);
  if (parts.length < 2) return null;

  const left = parts[0];
  const right = parts.slice(1).join(" - ");

  if (artistFirst) {
    return {
      requestedTitle: right,
      requestedArtist: left,
      confidence: 86,
    };
  }

  return {
    requestedTitle: left,
    requestedArtist: right,
    confidence: 82,
  };
}

export function parseWhatsAppSongRequest(rawText: string): WhatsAppRequestParseResult {
  const rawMessage = clean(rawText);
  if (!rawMessage) {
    return { isRequest: false, rawMessage: "", confidence: 0, ignoredReason: "empty_message" };
  }

  const requireKeyword = process.env.WHATSAPP_REQUIRE_KEYWORD !== "false";
  const keywords = getAllowedKeywords();
  if (requireKeyword && !containsKeyword(rawMessage, keywords)) {
    return { isRequest: false, rawMessage, confidence: 0, ignoredReason: "keyword_not_found" };
  }

  const stripped = stripRequestPrefix(rawMessage);
  const { requestText, dedication } = splitDedication(stripped.text);
  const parsedDash = parseDashFormat(requestText, stripped.artistFirst);

  if (parsedDash?.requestedTitle) {
    return {
      isRequest: true,
      rawMessage,
      requestedTitle: parsedDash.requestedTitle,
      requestedArtist: parsedDash.requestedArtist,
      dedication,
      confidence: parsedDash.confidence,
    };
  }

  if (requestText) {
    return {
      isRequest: true,
      rawMessage,
      requestedTitle: requestText,
      dedication,
      confidence: stripped.keyword ? 45 : 30,
    };
  }

  return {
    isRequest: true,
    rawMessage,
    requestedTitle: rawMessage,
    confidence: 20,
  };
}
