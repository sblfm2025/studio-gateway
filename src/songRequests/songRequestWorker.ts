import {
  gatewayDb,
  requestDb,
  Timestamp,
  setDocument,
  addDocument,
  runFirestoreOperation,
  shouldSkipFirestoreOperation,
} from "../firebaseClient";
import { Logger } from "../logger";
import type { FirestoreAuditLog, RadiobossCommand, SongRequest } from "../types";

const gatewayId = process.env.GATEWAY_ID || "studio-main";

function shouldAutoForward(): boolean {
  return process.env.SONG_REQUEST_AUTO_FORWARD_TO_RADIOBOSS === "true";
}

function getDummyRequestFilePath(): string {
  return (process.env.SONG_REQUEST_DUMMY_FILE_PATH || "").trim();
}

function buildRequestMessage(request: SongRequest): string {
  const rawMessage = typeof (request as any).rawMessage === "string" ? (request as any).rawMessage.trim() : "";
  const dedication = typeof (request as any).dedication === "string" ? (request as any).dedication.trim() : "";
  const message = typeof (request as any).message === "string" ? (request as any).message.trim() : "";
  const songText = [request.artist, request.title].filter(Boolean).join(" - ");

  return [
    rawMessage || songText || "Request lagu Radio SBL",
    dedication ? `Dedikasi: ${dedication}` : "",
    message && message !== rawMessage && message !== dedication ? message : "",
  ].filter(Boolean).join(" | ");
}

function getIntervalMs(): number {
  const raw = Number(process.env.SONG_REQUEST_WORKER_INTERVAL_SECONDS || 300);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 300000;
  return Math.min(900, Math.max(120, raw)) * 1000;
}

async function writeAuditLog(action: string, request: SongRequest, result: "success" | "failed" | "skipped", details: Record<string, any>) {
  const auditData: FirestoreAuditLog = {
    action,
    mode: "write",
    gatewayId,
    requestedAt: Timestamp.now(),
    result,
    details: {
      requestId: request.id,
      title: request.title,
      artist: request.artist || null,
      ...details,
    },
  };
  await addDocument("radiobossAuditLogs", auditData);
}

async function getPendingSongRequests(): Promise<SongRequest[]> {
  const snapshot = await runFirestoreOperation(
    "query songRequests pending",
      () => requestDb
      .collection("songRequests")
      .where("status", "in", ["new", "notified", "pending_review", "matched"])
      .limit(20)
      .get(),
  );

  return snapshot.docs.map((item: any) => ({ id: item.id, ...(item.data() as Omit<SongRequest, "id">) }));
}

async function createAddTrackCommand(request: SongRequest): Promise<string> {
  const commandId = `song-request-${request.id}`;
  const command: Omit<RadiobossCommand, "id"> = {
    type: "ADD_TRACK_TO_QUEUE",
    status: "pending",
    payload: {
      requestId: request.id,
      trackId: request.matchedTrackId || "",
      filePath: request.matchedFilePath,
      title: request.title,
      artist: request.artist || "",
      requesterName: request.requesterName || "Pendengar Radio SBL",
      message: buildRequestMessage(request),
    },
    requestedBy: "studio_gateway",
    requestedByName: "Studio Gateway",
    requestedAt: Timestamp.now(),
    priority: "normal",
    dedupeKey: `song-request-${request.id}`,
    attempts: 0,
    maxAttempts: 3,
    lockedBy: null,
    lockedAt: null,
    gatewayId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  const ref = gatewayDb.collection("radiobossCommands").doc(commandId);

  if (typeof gatewayDb.runTransaction !== "function") {
    const snapshot = await runFirestoreOperation(
      `get radiobossCommands/${commandId}`,
      () => ref.get(),
    );
    if (snapshot.exists) return commandId;
    await runFirestoreOperation(
      `set radiobossCommands/${commandId}`,
      () => ref.set(command, { merge: true }),
    );
    return commandId;
  }

  return runFirestoreOperation(`transaction create radiobossCommands/${commandId}`, () => gatewayDb.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return commandId;

    transaction.set(ref, command, { merge: true });
    return commandId;
  }));
}

async function forwardMatchedRequest(request: SongRequest): Promise<void> {
  if (!request.matchedFilePath || !request.matchedTrackId) {
    await writeAuditLog("song_request_forward_skipped", request, "skipped", {
      reason: "Request belum punya matchedFilePath atau matchedTrackId.",
    });
    return;
  }

  const commandId = await createAddTrackCommand(request);
  await setDocument("songRequests", request.id, {
    status: "sent_to_radioboss",
    sentToRadioBossAt: Timestamp.now(),
    radioBossCommandId: commandId,
    updatedAt: Timestamp.now(),
  });
  await writeAuditLog("song_request_forwarded_to_radioboss", request, "success", {
    commandId,
    matchedTrackId: request.matchedTrackId,
  });
}

async function processSongRequest(request: SongRequest): Promise<void> {
  const dummyFilePath = getDummyRequestFilePath();

  if (!dummyFilePath) {
    await setDocument("songRequests", request.id, {
      status: "needs_review",
      matchStatus: "unmatched",
      matchedTrackId: null,
      matchedFilePath: null,
      confidence: 0,
      updatedAt: Timestamp.now(),
    });
    await writeAuditLog("song_request_forward_skipped", request, "skipped", {
      reason: "SONG_REQUEST_DUMMY_FILE_PATH belum dikonfigurasi; request tidak dicek ke musicLibraryIndex.",
    });
    return;
  }

  const directRequest: SongRequest = {
    ...request,
    status: "matched",
    matchStatus: "matched",
    matchedTrackId: "radio-sbl-request-note",
    matchedFilePath: dummyFilePath,
    confidence: 100,
  };

  if (!shouldAutoForward()) {
    await setDocument("songRequests", request.id, {
      status: "needs_review",
      matchStatus: "matched",
      matchedTrackId: directRequest.matchedTrackId,
      matchedFilePath: dummyFilePath,
      confidence: 100,
      updatedAt: Timestamp.now(),
    });
    await writeAuditLog("song_request_direct_forward_disabled", request, "skipped", {
      matchedTrackId: directRequest.matchedTrackId,
      dummyFilePath,
      reason: "Auto-forward ke RadioBOSS nonaktif.",
    });
    return;
  }

  await forwardMatchedRequest(directRequest);
}

export async function processPendingSongRequests(): Promise<void> {
  if (shouldSkipFirestoreOperation("query songRequests pending")) return;

  const requests = await getPendingSongRequests();

  for (const request of requests) {
    try {
      await processSongRequest(request);
    } catch (error) {
      Logger.error(`[SongRequestWorker] Gagal memproses request ${request.id}: ${String(error)}`);
    }
  }
}

let isProcessing = false;

export function startSongRequestWorker(): NodeJS.Timeout {
  const intervalMs = getIntervalMs();
  Logger.info(
    `[SongRequestWorker] Aktif. Forward request setiap ${intervalMs / 1000} detik tanpa cek musicLibraryIndex. Auto-forward: ${shouldAutoForward() ? "on" : "off"}.`,
  );

  const run = async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processPendingSongRequests();
    } catch (error) {
      Logger.error(`[SongRequestWorker] Gagal memproses antrean request: ${String(error)}`);
    } finally {
      isProcessing = false;
    }
  };

  void run();
  return setInterval(run, intervalMs);
}
