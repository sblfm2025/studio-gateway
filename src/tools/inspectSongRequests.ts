import { requestDb } from "../firebaseClient";

function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function short(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

async function main() {
  const limitArg = Number(process.argv[2] || 10);
  const limit = Number.isFinite(limitArg) ? Math.min(30, Math.max(1, limitArg)) : 10;
  const snapshot = await requestDb
    .collection("songRequests")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const rows = snapshot.docs.map((doc: any) => {
    const data = doc.data();
    return {
      id: doc.id,
      status: data.status || null,
      source: data.source || null,
      requesterName: data.requesterName || null,
      phoneMasked: data.requesterPhoneMasked || null,
      title: data.title || data.requestedTitle || null,
      rawMessage: short(data.rawMessage || data.message || data.dedication),
      whatsappMessageId: data.whatsappMessageId ? "ada" : "tidak",
      createdAt: toIso(data.createdAt),
      updatedAt: toIso(data.updatedAt),
      sentToRadioBossAt: toIso(data.sentToRadioBossAt),
      queuedAt: toIso(data.queuedAt),
      radioBossCommandId: data.radioBossCommandId || null,
      gatewayId: data.gatewayId || null,
    };
  });

  console.table(rows);
}

main().catch((error) => {
  console.error(`[InspectRequests] Gagal membaca Firestore: ${String(error)}`);
  process.exitCode = 1;
});
