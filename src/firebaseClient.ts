import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import { initializeApp as initializeClientApp, type FirebaseApp } from "firebase/app";
import {
  addDoc as addClientDoc,
  collection as clientCollection,
  doc as clientDoc,
  getFirestore as getClientFirestore,
  setDoc as setClientDoc,
} from "firebase/firestore";
import { Logger } from "./logger";

dotenv.config();

const projectId = process.env.FIREBASE_PROJECT_ID || "radiosbl";
let serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json";
const recordingProjectId = process.env.RECORDING_FIREBASE_PROJECT_ID || "";
let recordingServiceAccountPath =
  process.env.RECORDING_GOOGLE_APPLICATION_CREDENTIALS || "";
const defaultGatewayServiceAccountPath = "./service-account-gateway.json";
const defaultRecordingServiceAccountPath = "./service-account-recording.json";
const requestProjectId =
  process.env.FIREBASE_GATEWAY_PROJECT_ID ||
  process.env.FIREBASE_REQUEST_PROJECT_ID ||
  process.env.FIREBASE_OVERLAY_PROJECT_ID ||
  "radio-sbl-overlay";
let requestServiceAccountPath =
  process.env.FIREBASE_GATEWAY_GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_REQUEST_GOOGLE_APPLICATION_CREDENTIALS || "";
const isMockFirebase = process.env.MOCK_FIREBASE === "true";

type FirestoreWriteTarget = "main" | "overlay" | "overlay2";

const overlayConfig = {
  apiKey: process.env.FIREBASE_OVERLAY_API_KEY || "AIzaSyAlLrzVLZyVRjdi3HGbwsEyvgUAOY4qRfY",
  authDomain: process.env.FIREBASE_OVERLAY_AUTH_DOMAIN || "radio-sbl-overlay.firebaseapp.com",
  projectId: process.env.FIREBASE_OVERLAY_PROJECT_ID || "radio-sbl-overlay",
  storageBucket: process.env.FIREBASE_OVERLAY_STORAGE_BUCKET || "radio-sbl-overlay.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_OVERLAY_MESSAGING_SENDER_ID || "1012850098092",
  appId: process.env.FIREBASE_OVERLAY_APP_ID || "1:1012850098092:web:1ee49e340bec2720228409",
};

const overlay2Config = {
  apiKey: process.env.FIREBASE_OVERLAY2_API_KEY || "AIzaSyCY7-rKolzbkV-fCdFvTyDSLbOuhnUvD38",
  authDomain: process.env.FIREBASE_OVERLAY2_AUTH_DOMAIN || "overlaysbl.firebaseapp.com",
  projectId: process.env.FIREBASE_OVERLAY2_PROJECT_ID || "overlaysbl",
  storageBucket: process.env.FIREBASE_OVERLAY2_STORAGE_BUCKET || "overlaysbl.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_OVERLAY2_MESSAGING_SENDER_ID || "319351353032",
  appId: process.env.FIREBASE_OVERLAY2_APP_ID || "1:319351353032:web:1fc549da031f369506fffd",
};

let overlayClientApp: FirebaseApp | null = null;
let overlay2ClientApp: FirebaseApp | null = null;
let overlayAdminDbInstance: any = null;
let overlay2AdminDbInstance: any = null;
const missingAdminFallbackLogged = new Set<FirestoreWriteTarget>();

function areRecordingFeaturesEnabled(): boolean {
  return (
    process.env.AUTO_RECORDING_ENABLED === "true" ||
    process.env.COMMAND_WORKER_ENABLED === "true"
  );
}

function isMultiProjectEnabled(): boolean {
  return process.env.FIREBASE_MULTI_PROJECT_ENABLED === "true";
}

function allowClientSdkWrites(): boolean {
  return process.env.FIREBASE_ALLOW_CLIENT_SDK_WRITES === "true";
}

function logMissingAdminFallback(target: Exclude<FirestoreWriteTarget, "main">) {
  if (missingAdminFallbackLogged.has(target)) return;
  missingAdminFallbackLogged.add(target);
  Logger.warn(
    `[Firestore Router] Admin SDK untuk target ${target} belum tersedia. Write sementara diarahkan ke Firebase utama.`,
  );
}

function getClientApp(target: Exclude<FirestoreWriteTarget, "main">): FirebaseApp {
  if (target === "overlay") {
    if (!overlayClientApp) {
      overlayClientApp = initializeClientApp(overlayConfig, "studio-gateway-overlay");
      Logger.info(`[Firebase Overlay] Client SDK siap untuk project "${overlayConfig.projectId}".`);
    }
    return overlayClientApp;
  }

  if (!overlay2ClientApp) {
    overlay2ClientApp = initializeClientApp(overlay2Config, "studio-gateway-overlay2");
    Logger.info(`[Firebase Overlay2] Client SDK siap untuk project "${overlay2Config.projectId}".`);
  }
  return overlay2ClientApp;
}

function getAdminDbForTarget(target: Exclude<FirestoreWriteTarget, "main">): any | null {
  return target === "overlay" ? overlayAdminDbInstance : overlay2AdminDbInstance;
}

function normalizeWriteTarget(value: string | undefined, fallback: FirestoreWriteTarget): FirestoreWriteTarget {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "main" || normalized === "overlay" || normalized === "overlay2") {
    return normalized;
  }
  return fallback;
}

function getCollectionWriteTarget(collection: string): FirestoreWriteTarget {
  if (!isMultiProjectEnabled()) return "main";

  const gatewayCollections = new Set([
    "radiobossStatus",
    "radiobossNowPlaying",
    "radiobossGatewayHeartbeat",
    "radiobossTrackHistory",
    "radiobossAuditLogs",
    "radiobossCommands",
    "songRequests",
    "musicLibraryIndex",
  ]);

  if (gatewayCollections.has(collection)) {
    return normalizeWriteTarget(
      process.env.FIRESTORE_ROUTE_GATEWAY || process.env.FIRESTORE_ROUTE_SONG_REQUESTS,
      "overlay",
    );
  }

  if (collection === "programRecordings" || collection === "programRecordingRules") {
    return normalizeWriteTarget(process.env.FIRESTORE_ROUTE_RECORDING, "overlay2");
  }

  return "main";
}

function toClientFirestoreValue(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => toClientFirestoreValue(item));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toClientFirestoreValue(item)]),
  );
}

function sanitizeAdminFirestoreValue(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value;
  if (value._methodName || String(value.constructor?.name || "").includes("FieldValue")) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeAdminFirestoreValue(item));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeAdminFirestoreValue(item)]),
  );
}

// Mock Implementation untuk Pengujian Offline
class MockDocumentReference {
  constructor(
    private collectionName: string,
    private docId: string,
  ) {}

  async set(data: any, options?: any) {
    Logger.info(
      `[Mock Firestore] set() -> Collection: "${this.collectionName}", Doc ID: "${this.docId}"`,
    );
    return { id: this.docId };
  }

  async get() {
    Logger.info(
      `[Mock Firestore] get() -> Collection: "${this.collectionName}", Doc ID: "${this.docId}"`,
    );
    return {
      exists: false,
      data: () => null,
    };
  }
}

class MockCollectionReference {
  constructor(private name: string) {}

  doc(id?: string) {
    const docId =
      id || `mock-doc-${Math.random().toString(36).substring(2, 9)}`;
    return new MockDocumentReference(this.name, docId);
  }

  async add(data: any) {
    const docId = `mock-doc-${Math.random().toString(36).substring(2, 9)}`;
    Logger.info(
      `[Mock Firestore] add() -> Collection: "${this.name}", Doc ID: "${docId}"`,
    );
    return { id: docId };
  }

  where() {
    return this;
  }

  limit() {
    return this;
  }

  async get() {
    Logger.info(
      `[Mock Firestore] query get() -> Collection: "${this.name}"`,
    );
    return {
      docs: [],
    };
  }
}

const mockDb = {
  collection(name: string) {
    return new MockCollectionReference(name);
  },
  async runTransaction(callback: any) {
    return callback({
      async get(ref: any) {
        return ref.get();
      },
      set(ref: any, data: any, options?: any) {
        return ref.set(data, options);
      },
    });
  },
};

let dbInstance: any;
let requestDbInstance: any;
let recordingDbInstance: any;
let timestampInstance: any;
let fieldValueInstance: any;
let quotaCooldownUntil = 0;
let lastQuotaCooldownLogAt = 0;

function resolveCredentialPath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), filePath);
}

function loadServiceAccount(filePath: string, label: string) {
  const resolvedPath = resolveCredentialPath(filePath);

  if (!fs.existsSync(resolvedPath)) {
    Logger.error(
      `[Firebase] ERROR: File kredensial ${label} tidak ditemukan di: ${resolvedPath}`,
    );
    process.exit(1);
  }

  try {
    return {
      resolvedPath,
      serviceAccount: JSON.parse(fs.readFileSync(resolvedPath, "utf8")),
    };
  } catch (err: any) {
    Logger.error(
      `[Firebase] ERROR FATAL: Gagal memuat kredensial ${label}: ${err.message || String(err)}`,
    );
    process.exit(1);
  }
}

function getFirestoreOpTimeoutMs(): number {
  const raw = Number(process.env.FIRESTORE_OP_TIMEOUT_MS || 30000);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 30000;
  return Math.min(60000, Math.max(5000, raw));
}

function getQuotaCooldownMs(): number {
  const raw = Number(process.env.FIRESTORE_QUOTA_COOLDOWN_SECONDS || 900);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 900000;
  return Math.min(3600, Math.max(60, raw)) * 1000;
}

function getFirestoreRetryAttempts(): number {
  const raw = Number(process.env.FIRESTORE_RETRY_ATTEMPTS || 1);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 1;
  return Math.min(3, Math.max(0, raw));
}

function getFirestoreRetryDelayMs(): number {
  const raw = Number(process.env.FIRESTORE_RETRY_DELAY_MS || 2000);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 2000;
  return Math.min(30000, Math.max(500, raw));
}

function getExponentialBackoffMs(attempt: number, baseDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.random() * 0.1 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, 60000);
}

function isQuotaError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("resource_exhausted") || message.includes("quota exceeded");
}

function isLocalTimeoutError(error: unknown): boolean {
  return String(error).toLowerCase().includes("melewati timeout lokal");
}

function isTransientFirestoreError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    isLocalTimeoutError(error) ||
    message.includes("deadline exceeded") ||
    message.includes("unavailable") ||
    message.includes("service unavailable") ||
    message.includes("network") ||
    message.includes("connection reset") ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  );
}

function activateQuotaCooldown(error: unknown) {
  if (!isQuotaError(error)) return;

  quotaCooldownUntil = Date.now() + getQuotaCooldownMs();
  Logger.warn(
    `[Firestore] Quota exceeded. Operasi Firestore non-kritis dijeda sementara selama ${Math.round(getQuotaCooldownMs() / 1000)} detik.`,
  );
}

function logCooldownSkip(operation: string) {
  const now = Date.now();
  if (now - lastQuotaCooldownLogAt < 60000) return;
  lastQuotaCooldownLogAt = now;
  const remainingSeconds = Math.max(0, Math.ceil((quotaCooldownUntil - now) / 1000));
  Logger.warn(
    `[Firestore] Melewati ${operation}; masih dalam masa cooldown quota sekitar ${remainingSeconds} detik.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runFirestoreOperation<T = any>(
  operation: string,
  createPromise: () => Promise<T>,
  options?: { retryOnTransient?: boolean },
): Promise<T> {
  if (shouldSkipFirestoreOperation(operation)) {
    throw new Error(`${operation} dilewati karena Firestore sedang cooldown quota`);
  }

  const timeoutMs = getFirestoreOpTimeoutMs();
  const retryAttempts = getFirestoreRetryAttempts();
  const retryDelayMs = getFirestoreRetryDelayMs();
  const retryOnTransient = options?.retryOnTransient !== false;

  const overallStart = Date.now();

  for (let attempt = 1; attempt <= retryAttempts + 1; attempt += 1) {
    let timeout: NodeJS.Timeout | null = null;
    const attemptStart = Date.now();
    try {
      const promise = createPromise();
      const result = await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${operation} melewati timeout lokal ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);

      const attemptElapsed = Date.now() - attemptStart;
      const totalElapsed = Date.now() - overallStart;
      Logger.info(`[Firestore] ${operation} berhasil pada attempt ${attempt} dalam ${attemptElapsed} ms (total ${totalElapsed} ms)`);
      return result;
    } catch (error) {
      if (isQuotaError(error)) {
        activateQuotaCooldown(error);
        throw error;
      }

      const isTimeout = isLocalTimeoutError(error);
      const transient = isTransientFirestoreError(error);
      const canRetry = retryOnTransient && transient && attempt <= retryAttempts;

      if (canRetry) {
        const backoffMs = getExponentialBackoffMs(attempt, retryDelayMs);
        Logger.warn(
          `[Firestore] Operasi ${operation} gagal pada attempt ${attempt} karena error transient: ${String(error)}. Mencoba lagi dalam ${backoffMs} ms...`,
        );
        await sleep(backoffMs);
        continue;
      }

      if (isTimeout) {
        Logger.warn(
          `[Firestore] Operasi ${operation} melewati timeout lokal ${timeoutMs} ms pada attempt ${attempt}.`,
        );
      }

      const totalElapsed = Date.now() - overallStart;
      Logger.error(`[Firestore] ${operation} gagal secara permanen setelah ${attempt} attempt, total ${totalElapsed} ms. Error: ${String(error)}`);
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw new Error(`${operation} gagal setelah ${retryAttempts + 1} percobaan.`);
}

export function isFirestoreQuotaCoolingDown(): boolean {
  return Date.now() < quotaCooldownUntil;
}

export function shouldSkipFirestoreOperation(operation: string): boolean {
  if (!isFirestoreQuotaCoolingDown()) return false;
  logCooldownSkip(operation);
  return true;
}

if (isMockFirebase) {
  Logger.info("==================================================");
  Logger.info("   FIRESTORE DALAM MODE SIMULASI (OFFLINE MOCK)   ");
  Logger.info("   Semua penulisan data akan dicetak ke log!     ");
  Logger.info("==================================================");

  dbInstance = mockDb;
  requestDbInstance = mockDb;
  recordingDbInstance = mockDb;
  timestampInstance = {
    now: () => new Date(),
  };
  fieldValueInstance = {
    serverTimestamp: () => new Date(),
  };
} else {
  Logger.info(`[Firebase] Menginisialisasi proyek ID: "${projectId}"`);

  const mainCredential = loadServiceAccount(serviceAccountPath, "utama");
  admin.initializeApp({
    credential: admin.credential.cert(mainCredential.serviceAccount),
    projectId,
  });
  Logger.info(
    `[Firebase] Inisialisasi utama berhasil menggunakan berkas kredensial di: ${mainCredential.resolvedPath}`,
  );

  dbInstance = admin.firestore();
  requestDbInstance = dbInstance;
  recordingDbInstance = dbInstance;
  requestServiceAccountPath =
    requestServiceAccountPath || existingOptionalCredentialPath(defaultGatewayServiceAccountPath);
  recordingServiceAccountPath =
    recordingServiceAccountPath || existingOptionalCredentialPath(defaultRecordingServiceAccountPath);

  if (requestProjectId && requestServiceAccountPath) {
    const requestCredential = loadServiceAccount(requestServiceAccountPath, "gateway RadioBOSS");
    const requestApp = admin.initializeApp(
      {
        credential: admin.credential.cert(requestCredential.serviceAccount),
        projectId: requestProjectId,
      },
      "gateway",
    );
    requestDbInstance = requestApp.firestore();
    overlayAdminDbInstance = requestDbInstance;
    Logger.info(
      `[Firebase Gateway] Admin SDK siap untuk project "${requestProjectId}" menggunakan kredensial di: ${requestCredential.resolvedPath}`,
    );
  } else if (isMultiProjectEnabled()) {
    Logger.warn(
      `[Firebase Gateway] FIREBASE_GATEWAY_GOOGLE_APPLICATION_CREDENTIALS/FIREBASE_REQUEST_GOOGLE_APPLICATION_CREDENTIALS kosong. Koleksi RadioBOSS tetap memakai Firebase utama sampai kredensial project "${requestProjectId}" siap.`,
    );
  }

  if (recordingProjectId) {
    if (!recordingServiceAccountPath) {
      if (areRecordingFeaturesEnabled()) {
        Logger.error(
          "[Firebase Recording] RECORDING_FIREBASE_PROJECT_ID terisi, tetapi RECORDING_GOOGLE_APPLICATION_CREDENTIALS kosong. Fitur recording/command aktif, startup dihentikan agar recording tidak salah project.",
        );
        process.exit(1);
      }
      Logger.warn(
        "[Firebase Recording] RECORDING_FIREBASE_PROJECT_ID terisi, tetapi RECORDING_GOOGLE_APPLICATION_CREDENTIALS kosong. Recording tetap memakai Firebase utama.",
      );
    } else if (!fs.existsSync(resolveCredentialPath(recordingServiceAccountPath))) {
      const message =
        `[Firebase Recording] RECORDING_FIREBASE_PROJECT_ID terisi, tetapi file kredensial recording tidak ditemukan di: ${resolveCredentialPath(recordingServiceAccountPath)}.`;
      if (areRecordingFeaturesEnabled()) {
        Logger.error(`${message} Fitur recording/command aktif, startup dihentikan agar tidak salah menulis data.`);
        process.exit(1);
      }
      Logger.warn(`${message} Fitur recording/command nonaktif, recording tetap memakai Firebase utama.`);
    } else {
      Logger.info(`[Firebase Recording] Menginisialisasi proyek ID: "${recordingProjectId}"`);
      const recordingCredential = loadServiceAccount(recordingServiceAccountPath, "recording");
      const recordingApp = admin.initializeApp(
        {
          credential: admin.credential.cert(recordingCredential.serviceAccount),
          projectId: recordingProjectId,
        },
        "recording",
      );
      recordingDbInstance = recordingApp.firestore();
      if (recordingProjectId === overlay2Config.projectId) {
        overlay2AdminDbInstance = recordingDbInstance;
      }
      Logger.info(
        `[Firebase Recording] Inisialisasi berhasil menggunakan berkas kredensial di: ${recordingCredential.resolvedPath}`,
      );
    }
  }

  const overlayCredentialPath = process.env.FIREBASE_OVERLAY_GOOGLE_APPLICATION_CREDENTIALS || "";
  if (overlayCredentialPath && !overlayAdminDbInstance) {
    const overlayCredential = loadServiceAccount(overlayCredentialPath, "overlay");
    const overlayAdminApp = admin.initializeApp(
      {
        credential: admin.credential.cert(overlayCredential.serviceAccount),
        projectId: overlayConfig.projectId,
      },
      "overlay",
    );
    overlayAdminDbInstance = overlayAdminApp.firestore();
    Logger.info(
      `[Firebase Overlay] Admin SDK siap untuk project "${overlayConfig.projectId}" menggunakan kredensial di: ${overlayCredential.resolvedPath}`,
    );
  } else if (isMultiProjectEnabled() && !overlayAdminDbInstance) {
    Logger.warn(
      `[Firebase Overlay] FIREBASE_OVERLAY_GOOGLE_APPLICATION_CREDENTIALS kosong. Write ke "${overlayConfig.projectId}" ${allowClientSdkWrites() ? "akan memakai Web SDK dan tunduk pada Firestore Rules" : "sementara fallback ke Firebase utama"}.`,
    );
  }

  const overlay2CredentialPath = process.env.FIREBASE_OVERLAY2_GOOGLE_APPLICATION_CREDENTIALS || "";
  if (overlay2CredentialPath) {
    const overlay2Credential = loadServiceAccount(overlay2CredentialPath, "overlay2");
    const overlay2AdminApp = admin.initializeApp(
      {
        credential: admin.credential.cert(overlay2Credential.serviceAccount),
        projectId: overlay2Config.projectId,
      },
      "overlay2",
    );
    overlay2AdminDbInstance = overlay2AdminApp.firestore();
    Logger.info(
      `[Firebase Overlay2] Admin SDK siap untuk project "${overlay2Config.projectId}" menggunakan kredensial di: ${overlay2Credential.resolvedPath}`,
    );
  } else if (isMultiProjectEnabled()) {
    Logger.warn(
      `[Firebase Overlay2] FIREBASE_OVERLAY2_GOOGLE_APPLICATION_CREDENTIALS kosong. Write ke "${overlay2Config.projectId}" ${allowClientSdkWrites() ? "akan memakai Web SDK dan tunduk pada Firestore Rules" : "sementara fallback ke Firebase utama"}.`,
    );
  }

  timestampInstance = admin.firestore.Timestamp;
  fieldValueInstance = admin.firestore.FieldValue;
}

export const db = dbInstance;
export const gatewayDb = requestDbInstance;
export const requestDb = requestDbInstance;
export const recordingDb = recordingDbInstance;
export const Timestamp = timestampInstance;
export const FieldValue = fieldValueInstance;

async function setDocumentOnDb(
  targetDb: any,
  collection: string,
  docId: string,
  data: object,
  merge = true,
  options?: { retryOnTransient?: boolean },
): Promise<boolean> {
  const operation = `set ${collection}/${docId}`;
  if (shouldSkipFirestoreOperation(operation)) return false;

  try {
    await runFirestoreOperation(
      operation,
      () => targetDb.collection(collection).doc(docId).set(sanitizeAdminFirestoreValue(data), { merge }),
      options,
    );
    return true;
  } catch (err: any) {
    Logger.error(
      `[Firestore] Gagal menulis dokumen "${collection}/${docId}": ${err.message || String(err)}`,
    );
    throw err;
  }
}

function existingOptionalCredentialPath(filePath: string): string {
  return filePath && fs.existsSync(resolveCredentialPath(filePath)) ? filePath : "";
}

async function setDocumentOnClientProject(
  target: Exclude<FirestoreWriteTarget, "main">,
  collection: string,
  docId: string,
  data: object,
  merge = true,
  options?: { retryOnTransient?: boolean },
): Promise<boolean> {
  const operation = `set ${target}:${collection}/${docId}`;
  if (shouldSkipFirestoreOperation(operation)) return false;

  try {
    const clientDb = getClientFirestore(getClientApp(target));
    await runFirestoreOperation(
      operation,
      () =>
        setClientDoc(
          clientDoc(clientDb, collection, docId),
          toClientFirestoreValue(data),
          { merge },
        ),
      options,
    );
    return true;
  } catch (err: any) {
    Logger.error(
      `[Firestore ${target}] Gagal menulis dokumen "${collection}/${docId}": ${err.message || String(err)}`,
    );
    throw err;
  }
}

// Helper Write Terpadu: menulis dokumen secara konsisten
export async function setDocument(
  collection: string,
  docId: string,
  data: object,
  merge = true,
  options?: { retryOnTransient?: boolean },
): Promise<boolean> {
  const target = getCollectionWriteTarget(collection);
  if (target === "main" || isMockFirebase) {
    return setDocumentOnDb(db, collection, docId, data, merge, options);
  }

  const adminTargetDb = getAdminDbForTarget(target);
  if (adminTargetDb) {
    return setDocumentOnDb(adminTargetDb, collection, docId, data, merge, options);
  }

  if (!allowClientSdkWrites()) {
    logMissingAdminFallback(target);
    return setDocumentOnDb(db, collection, docId, data, merge, options);
  }

  try {
    return await setDocumentOnClientProject(target, collection, docId, data, merge, options);
  } catch (err) {
    Logger.warn(
      `[Firestore Router] Fallback ke Firebase utama untuk ${collection}/${docId} karena write ke ${target} gagal: ${String(err)}`,
    );
    return setDocumentOnDb(db, collection, docId, data, merge, options);
  }
}

export async function setRecordingDocument(
  collection: string,
  docId: string,
  data: object,
  merge = true,
  options?: { retryOnTransient?: boolean },
): Promise<boolean> {
  return setDocumentOnDb(recordingDb, collection, docId, data, merge, options);
}

// Helper Write Terpadu: menambahkan dokumen acak secara konsisten
export async function addDocument(collection: string, data: object) {
  const target = getCollectionWriteTarget(collection);
  const adminTargetDb = target === "main" || isMockFirebase ? null : getAdminDbForTarget(target);
  const shouldFallbackToMain =
    target !== "main" &&
    !isMockFirebase &&
    !adminTargetDb &&
    !allowClientSdkWrites();
  if (shouldFallbackToMain) {
    logMissingAdminFallback(target);
  }

  const operation =
    target === "main" || isMockFirebase || shouldFallbackToMain
      ? `add ${collection}`
      : `add ${target}:${collection}`;
  if (shouldSkipFirestoreOperation(operation)) {
    return `skipped-quota-cooldown-${Date.now()}`;
  }

  try {
    const ref = await runFirestoreOperation<any>(
      operation,
      () => {
        if (target === "main" || isMockFirebase || shouldFallbackToMain) {
          return db.collection(collection).add(sanitizeAdminFirestoreValue(data));
        }
        if (adminTargetDb) {
          return adminTargetDb.collection(collection).add(sanitizeAdminFirestoreValue(data));
        }
        const clientDb = getClientFirestore(getClientApp(target));
        return addClientDoc(clientCollection(clientDb, collection), toClientFirestoreValue(data));
      },
      { retryOnTransient: false },
    );
    return ref.id;
  } catch (err: any) {
    if (target !== "main" && !isMockFirebase) {
      Logger.warn(
        `[Firestore Router] Fallback add ke Firebase utama untuk ${collection} karena write ke ${target} gagal: ${err.message || String(err)}`,
      );
      const fallbackRef = await runFirestoreOperation<any>(
        `add ${collection}`,
        () => db.collection(collection).add(sanitizeAdminFirestoreValue(data)),
        { retryOnTransient: false },
      );
      return fallbackRef.id;
    }

    Logger.error(
      `[Firestore] Gagal menambahkan dokumen ke koleksi "${collection}": ${err.message || String(err)}`,
    );
    throw err;
  }
}
