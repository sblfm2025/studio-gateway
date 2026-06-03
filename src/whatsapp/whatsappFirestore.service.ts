import { db, Timestamp, runFirestoreOperation } from "../firebaseClient";
import type { WhatsAppRequestDocument, WhatsAppRequestSaveInput } from "./whatsappTypes";

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 8) return "****";
  return `${digits.slice(0, 5)}****${digits.slice(-4)}`;
}

async function findExistingRequestId(whatsappMessageId?: string): Promise<string | null> {
  if (!whatsappMessageId) return null;

  const snapshot = await runFirestoreOperation(
    "query songRequests whatsapp duplicate",
    () => db
      .collection("songRequests")
      .where("whatsappMessageId", "==", whatsappMessageId)
      .limit(1)
      .get(),
  );

  return snapshot.docs[0]?.id || null;
}

export async function saveWhatsAppSongRequest(input: WhatsAppRequestSaveInput): Promise<string> {
  const existingId = await findExistingRequestId(input.whatsappMessageId);
  if (existingId) return existingId;

  const requestedTitle = input.requestedTitle || input.rawMessage;
  const documentData: WhatsAppRequestDocument = {
    source: "whatsapp",
    channel: "whatsapp",
    status: "pending_review",
    reviewStatus: "pending",
    matchStatus: "unmatched",
    rawMessage: input.rawMessage,
    requestedTitle,
    ...(input.requestedArtist ? { requestedArtist: input.requestedArtist } : {}),
    ...(input.dedication ? { dedication: input.dedication } : {}),
    title: requestedTitle,
    ...(input.requestedArtist ? { artist: input.requestedArtist } : {}),
    ...(input.dedication ? { message: input.dedication } : {}),
    notificationText: input.rawMessage,
    requesterName: input.requesterName || "Pendengar WhatsApp",
    requesterPhoneMasked: maskPhone(input.requesterPhone),
    ...(input.whatsappMessageId ? { whatsappMessageId: input.whatsappMessageId } : {}),
    confidence: input.confidence,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  const ref = await runFirestoreOperation(
    "add songRequests whatsapp",
    () => db.collection("songRequests").add(documentData),
  );
  return ref.id;
}
