export type WhatsAppRequestParseResult = {
  isRequest: boolean;
  rawMessage: string;
  requestedTitle?: string;
  requestedArtist?: string;
  dedication?: string;
  confidence: number;
  ignoredReason?: string;
};

export type WhatsAppRequestDocument = {
  source: "whatsapp";
  channel: "whatsapp";
  status: "pending_review";
  reviewStatus: "pending";
  matchStatus: "unmatched";
  rawMessage: string;
  requestedTitle: string;
  requestedArtist?: string;
  dedication?: string;
  title: string;
  artist?: string;
  message?: string;
  notificationText: string;
  requesterName: string;
  requesterPhoneMasked: string;
  whatsappMessageId?: string;
  confidence: number;
  createdAt: any;
  updatedAt: any;
};

export type WhatsAppRequestSaveInput = WhatsAppRequestParseResult & {
  requesterName?: string;
  requesterPhone: string;
  whatsappMessageId?: string;
};

export type WhatsAppRateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};
