import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';
import { Logger } from './logger';

dotenv.config();

const projectId = process.env.FIREBASE_PROJECT_ID || 'radiosbl';
let serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json';
const isMockFirebase = process.env.MOCK_FIREBASE === 'true';

// Mock Implementation untuk Pengujian Offline
class MockDocumentReference {
  constructor(private collectionName: string, private docId: string) {}
  
  async set(data: any, options?: any) {
    Logger.info(`[Mock Firestore] set() -> Collection: "${this.collectionName}", Doc ID: "${this.docId}"`);
    return { id: this.docId };
  }

  async get() {
    Logger.info(`[Mock Firestore] get() -> Collection: "${this.collectionName}", Doc ID: "${this.docId}"`);
    return {
      exists: false,
      data: () => null
    };
  }
}

class MockCollectionReference {
  constructor(private name: string) {}
  
  doc(id?: string) {
    const docId = id || `mock-doc-${Math.random().toString(36).substring(2, 9)}`;
    return new MockDocumentReference(this.name, docId);
  }

  async add(data: any) {
    const docId = `mock-doc-${Math.random().toString(36).substring(2, 9)}`;
    Logger.info(`[Mock Firestore] add() -> Collection: "${this.name}", Doc ID: "${docId}"`);
    return { id: docId };
  }
}

const mockDb = {
  collection(name: string) {
    return new MockCollectionReference(name);
  }
};

let dbInstance: any;
let timestampInstance: any;
let fieldValueInstance: any;

if (isMockFirebase) {
  Logger.info('==================================================');
  Logger.info('   FIRESTORE DALAM MODE SIMULASI (OFFLINE MOCK)   ');
  Logger.info('   Semua penulisan data akan dicetak ke log!     ');
  Logger.info('==================================================');
  
  dbInstance = mockDb;
  timestampInstance = {
    now: () => new Date()
  };
  fieldValueInstance = {
    serverTimestamp: () => new Date()
  };
} else {
  // Ubah relative path ke absolute path secara aman
  if (!path.isAbsolute(serviceAccountPath)) {
    serviceAccountPath = path.resolve(process.cwd(), serviceAccountPath);
  }

  Logger.info(`[Firebase] Menginisialisasi proyek ID: "${projectId}"`);

  // Validasi keberadaan file credential secara ketat saat live mode
  if (!fs.existsSync(serviceAccountPath)) {
    Logger.error(`[Firebase] ERROR: File service-account.json tidak ditemukan di: ${serviceAccountPath}`);
    Logger.error(`[Firebase] Harap siapkan service-account.json sesuai panduan INSTALL_WINDOWS.md sebelum menggunakan live mode.`);
    process.exit(1);
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId
    });
    Logger.info(`[Firebase] Inisialisasi berhasil menggunakan berkas kredensial di: ${serviceAccountPath}`);
  } catch (err: any) {
    Logger.error(`[Firebase] ERROR FATAL: Gagal memuat berkas service-account.json: ${err.message || String(err)}`);
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
export async function setDocument(collection: string, docId: string, data: object, merge = true) {
  try {
    await db.collection(collection).doc(docId).set(data, { merge });
  } catch (err: any) {
    Logger.error(`[Firestore] Gagal menulis dokumen "${collection}/${docId}": ${err.message || String(err)}`);
    throw err;
  }
}

// Helper Write Terpadu: menambahkan dokumen acak secara konsisten
export async function addDocument(collection: string, data: object) {
  try {
    const ref = await db.collection(collection).add(data);
    return ref.id;
  } catch (err: any) {
    Logger.error(`[Firestore] Gagal menambahkan dokumen ke koleksi "${collection}": ${err.message || String(err)}`);
    throw err;
  }
}
