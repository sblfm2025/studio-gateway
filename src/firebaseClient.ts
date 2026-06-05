import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import { Logger } from "./logger";

dotenv.config();

const projectId = process.env.FIREBASE_PROJECT_ID || "radiosbl";
let serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json";
const recordingProjectId = process.env.RECORDING_FIREBASE_PROJECT_ID || "";
let recordingServiceAccountPath =
  process.env.RECORDING_GOOGLE_APPLICATION_CREDENTIALS || "";
const isMockFirebase = process.env.MOCK_FIREBASE === "true";

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
  recordingDbInstance = dbInstance;

  if (recordingProjectId) {
    if (!recordingServiceAccountPath) {
      Logger.warn(
        "[Firebase Recording] RECORDING_FIREBASE_PROJECT_ID terisi, tetapi RECORDING_GOOGLE_APPLICATION_CREDENTIALS kosong. Recording tetap memakai Firebase utama.",
      );
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
      Logger.info(
        `[Firebase Recording] Inisialisasi berhasil menggunakan berkas kredensial di: ${recordingCredential.resolvedPath}`,
      );
    }
  }

  timestampInstance = admin.firestore.Timestamp;
  fieldValueInstance = admin.firestore.FieldValue;
}

export const db = dbInstance;
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
      () => targetDb.collection(collection).doc(docId).set(data, { merge }),
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

// Helper Write Terpadu: menulis dokumen secara konsisten
export async function setDocument(
  collection: string,
  docId: string,
  data: object,
  merge = true,
  options?: { retryOnTransient?: boolean },
): Promise<boolean> {
  return setDocumentOnDb(db, collection, docId, data, merge, options);
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
  const operation = `add ${collection}`;
  if (shouldSkipFirestoreOperation(operation)) {
    return `skipped-quota-cooldown-${Date.now()}`;
  }

  try {
    const ref = await runFirestoreOperation<any>(
      operation,
      () => db.collection(collection).add(data),
      { retryOnTransient: false },
    );
    return ref.id;
  } catch (err: any) {
    Logger.error(
      `[Firestore] Gagal menambahkan dokumen ke koleksi "${collection}": ${err.message || String(err)}`,
    );
    throw err;
  }
}
