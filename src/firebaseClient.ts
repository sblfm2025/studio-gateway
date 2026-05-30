import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const projectId = process.env.FIREBASE_PROJECT_ID || 'radiosbl-project';
let serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json';
const isMockFirebase = process.env.MOCK_FIREBASE === 'true';

// Mock Implementation untuk Pengujian Offline
class MockDocumentReference {
  constructor(private collectionName: string, private docId: string) {}
  
  async set(data: any, options?: any) {
    console.log(`[Mock Firestore] set() -> Collection: "${this.collectionName}", Doc ID: "${this.docId}"`);
    console.log(`[Mock Firestore] Data:`, JSON.stringify(data, null, 2));
    return { id: this.docId };
  }

  async get() {
    console.log(`[Mock Firestore] get() -> Collection: "${this.collectionName}", Doc ID: "${this.docId}"`);
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
    console.log(`[Mock Firestore] add() -> Collection: "${this.name}", Doc ID: "${docId}"`);
    console.log(`[Mock Firestore] Data:`, JSON.stringify(data, null, 2));
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
  console.log('==================================================');
  console.log('   FIRESTORE DALAM MODE SIMULASI (OFFLINE MOCK)   ');
  console.log('   Semua penulisan data akan dicetak ke konsol!  ');
  console.log('==================================================');
  
  dbInstance = mockDb;
  timestampInstance = {
    now: () => new Date()
  };
  fieldValueInstance = {
    serverTimestamp: () => new Date()
  };
} else {
  // Resolving relative path to absolute path based on execution context
  if (!path.isAbsolute(serviceAccountPath)) {
    serviceAccountPath = path.resolve(process.cwd(), serviceAccountPath);
  }

  console.log(`[Firebase] Menginisialisasi proyek ID: "${projectId}"`);

  if (!fs.existsSync(serviceAccountPath)) {
    console.warn(`[Firebase] WARNING: File service-account.json tidak ditemukan di: ${serviceAccountPath}`);
    console.warn(`[Firebase] Berjalan dengan kredensial default bawaan Cloud...`);
    
    admin.initializeApp({
      projectId
    });
  } else {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId
      });
      console.log(`[Firebase] Inisialisasi berhasil menggunakan berkas kredensial di: ${serviceAccountPath}`);
    } catch (err: any) {
      console.error(`[Firebase] ERROR: Gagal membaca file service-account.json dari ${serviceAccountPath}:`, err);
      console.warn(`[Firebase] Mencoba fallback ke kredensial default bawaan...`);
      admin.initializeApp({
        projectId
      });
    }
  }

  dbInstance = admin.firestore();
  timestampInstance = admin.firestore.Timestamp;
  fieldValueInstance = admin.firestore.FieldValue;
}

export const db = dbInstance;
export const Timestamp = timestampInstance;
export const FieldValue = fieldValueInstance;
