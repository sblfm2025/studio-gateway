import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import { Logger } from "./logger";

dotenv.config();

const projectId = process.env.FIREBASE_PROJECT_ID || "radiosbl";
let serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json";
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
let timestampInstance: any;
let fieldValueInstance: any;
let quotaCooldownUntil = 0;
let lastQuotaCooldownLogAt = 0;

function getFirestoreOpTimeoutMs(): number {
  const raw = Number(process.env.FIRESTORE_OP_TIMEOUT_MS || 15000);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 15000;
  return Math.min(60000, Math.max(5000, raw));
}

function getQuotaCooldownMs(): number {
  const raw = Number(process.env.FIRESTORE_QUOTA_COOLDOWN_SECONDS || 300);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return 300000;
  return Math.min(3600, Math.max(60, raw)) * 1000;
}

function isQuotaError(error: unknown): boolean {
  const message = String(error);
  return message.includes("RESOURCE_EXHAUSTED") || message.includes("Quota exceeded");
}

function activateQuotaCooldown(error: unknown) {
  const message = String(error);
  if (!isQuotaError(error) && !message.includes("melewati timeout lokal")) return;

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

export async function runFirestoreOperation<T = any>(operation: string, createPromise: () => Promise<T>): Promise<T> {
  if (shouldSkipFirestoreOperation(operation)) {
    throw new Error(`${operation} dilewati karena Firestore sedang cooldown quota`);
  }

  const timeoutMs = getFirestoreOpTimeoutMs();
  let timeout: NodeJS.Timeout | null = null;
  try {
    const promise = createPromise();
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${operation} melewati timeout lokal ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    activateQuotaCooldown(error);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  timestampInstance = {
    now: () => new Date(),
  };
  fieldValueInstance = {
    serverTimestamp: () => new Date(),
  };
} else {
  // Ubah relative path ke absolute path secara aman
  if (!path.isAbsolute(serviceAccountPath)) {
    serviceAccountPath = path.resolve(process.cwd(), serviceAccountPath);
  }

  Logger.info(`[Firebase] Menginisialisasi proyek ID: "${projectId}"`);

  // Validasi keberadaan file credential secara ketat saat live mode
  if (!fs.existsSync(serviceAccountPath)) {
    Logger.error(
      `[Firebase] ERROR: File service-account.json tidak ditemukan di: ${serviceAccountPath}`,
    );
    Logger.error(
      `[Firebase] Harap siapkan service-account.json sesuai panduan INSTALL_WINDOWS.md sebelum menggunakan live mode.`,
    );
    process.exit(1);
  }

  try {
    const serviceAccount = JSON.parse(
      fs.readFileSync(serviceAccountPath, "utf8"),
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
    Logger.info(
      `[Firebase] Inisialisasi berhasil menggunakan berkas kredensial di: ${serviceAccountPath}`,
    );
  } catch (err: any) {
    Logger.error(
      `[Firebase] ERROR FATAL: Gagal memuat berkas service-account.json: ${err.message || String(err)}`,
    );
    process.exit(1);
  }

  dbInstance = admin.firestore();
  timestampInstance = admin.firestore.Timestamp;
  fieldValueInstance = admin.firestore.FieldValue;
}

export const db = dbInstance;
export const Timestamp = timestampInstance;
export const FieldValue = fieldValueInstance;

// Helper Write Terpadu: menulis dokumen secara konsisten
export async function setDocument(
  collection: string,
  docId: string,
  data: object,
  merge = true,
) {
  const operation = `set ${collection}/${docId}`;
  if (shouldSkipFirestoreOperation(operation)) return;

  try {
    await runFirestoreOperation(operation, () => db.collection(collection).doc(docId).set(data, { merge }));
  } catch (err: any) {
    Logger.error(
      `[Firestore] Gagal menulis dokumen "${collection}/${docId}": ${err.message || String(err)}`,
    );
    throw err;
  }
}

// Helper Write Terpadu: menambahkan dokumen acak secara konsisten
export async function addDocument(collection: string, data: object) {
  const operation = `add ${collection}`;
  if (shouldSkipFirestoreOperation(operation)) {
    return `skipped-quota-cooldown-${Date.now()}`;
  }

  try {
    const ref = await runFirestoreOperation<any>(operation, () => db.collection(collection).add(data));
    return ref.id;
  } catch (err: any) {
    Logger.error(
      `[Firestore] Gagal menambahkan dokumen ke koleksi "${collection}": ${err.message || String(err)}`,
    );
    throw err;
  }
}
