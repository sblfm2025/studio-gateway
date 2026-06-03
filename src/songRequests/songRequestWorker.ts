import { db, Timestamp, setDocument, addDocument } from "../firebaseClient";
import { Logger } from "../logger";
import type { FirestoreAuditLog, RadiobossCommand, SongRequest } from "../types";
import { findBestLibraryMatches } from "./musicLibraryMatcher";

const gatewayId = process.env.GATEWAY_ID || "studio-main";

function shouldAutoForward(): boolean {
  return process.env.SONG_REQUEST_AUTO_FORWARD_TO_RADIOBOSS !== "false";
}

function getAutoForwardThreshold(): number {
  const raw = Number(process.env.SONG_REQUEST_AUTO_FORWARD_MIN_CONFIDENCE || 80);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 80;
  return Math.min(100, Math.max(50, raw));
}

function getIntervalMs(): number {
  const raw = Number(process.env.SONG_REQUEST_WORKER_INTERVAL_SECONDS || 30);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 30000;
  return Math.min(180, Math.max(15, raw)) * 1000;
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
  const snapshot = await db
    .collection("songRequests")
    .where("status", "in", ["new", "notified", "matched"])
    .limit(20)
    .get();

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

  const ref = db.collection("radiobossCommands").doc(commandId);

  if (typeof db.runTransaction !== "function") {
    const snapshot = await ref.get();
    if (snapshot.exists) return commandId;
    await ref.set(command, { merge: true });
    return commandId;
  }

  return db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return commandId;

    transaction.set(ref, command, { merge: true });
    return commandId;
  });
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
  if (request.status === "matched") {
    if (shouldAutoForward()) await forwardMatchedRequest(request);
    return;
  }

  const matches = await findBestLibraryMatches(request);
  const best = matches[0];

  if (!best) {
    await setDocument("songRequests", request.id, {
      status: "needs_review",
      matchStatus: "not_found",
      matchedTrackId: null,
      matchedFilePath: null,
      confidence: 0,
      updatedAt: Timestamp.now(),
    });
    await writeAuditLog("song_request_match_not_found", request, "skipped", {
      reason: "Tidak ada kandidat di musicLibraryIndex.",
    });
    return;
  }

  const isHighConfidence = best.confidence >= getAutoForwardThreshold() && matches.length === 1;
  const matchedUpdate = {
    status: isHighConfidence ? "matched" : "needs_review",
    matchStatus: isHighConfidence ? "matched" : "ambiguous",
    matchedTrackId: best.id,
    matchedFilePath: best.filePath,
    confidence: best.confidence,
    updatedAt: Timestamp.now(),
  };
  await setDocument("songRequests", request.id, {
    ...matchedUpdate,
  });

  await writeAuditLog("song_request_matched", request, "success", {
    matchStatus: isHighConfidence ? "matched" : "ambiguous",
    matchedTrackId: best.id,
    confidence: best.confidence,
  });

  if (isHighConfidence && shouldAutoForward()) {
    await forwardMatchedRequest({
      ...request,
      status: "matched",
      matchStatus: "matched",
      matchedTrackId: best.id,
      matchedFilePath: best.filePath,
      confidence: best.confidence,
    });
  }
}

export async function processPendingSongRequests(): Promise<void> {
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
    `[SongRequestWorker] Aktif. Matching request setiap ${intervalMs / 1000} detik. Auto-forward: ${shouldAutoForward() ? "on" : "off"}.`,
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
