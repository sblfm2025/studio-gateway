import * as os from 'os';
import dotenv from 'dotenv';
import { db, Timestamp, setDocument, addDocument } from './firebaseClient';
import { fetchPlaybackInfoFromRadioBoss } from './radiobossClient';
import { parsePlaybackInfo } from './parsePlaybackInfo';
import { normalizePlayback } from './normalizeTrack';
import { Logger } from './logger';
import { FirestoreRadiobossStatus, FirestoreNowPlaying, FirestoreGatewayHeartbeat, FirestoreTrackHistory, FirestoreAuditLog } from './types';

dotenv.config();

export const gatewayId = process.env.GATEWAY_ID || 'studio-main';
const gatewayName = process.env.GATEWAY_NAME || 'Studio Utama Radio SBL';
export const pcName = process.env.PC_NAME || os.hostname() || 'STUDIO-SBL';
export const appVersion = '1.0.0';

// 1. Validasi Batas Polling Aman (Minimal 5 detik, Maksimal 60 detik)
function getPollIntervalMs(): number {
  const raw = parseInt(process.env.POLL_INTERVAL_SECONDS || '10', 10);
  if (isNaN(raw)) {
    Logger.warn('[Config] POLL_INTERVAL_SECONDS tidak valid. Menggunakan default 10 detik.');
    return 10000;
  }
  const safeSeconds = Math.min(60, Math.max(5, raw));
  if (safeSeconds !== raw) {
    Logger.warn(`[Config] POLL_INTERVAL_SECONDS disesuaikan dari ${raw} ke batas aman ${safeSeconds} detik.`);
  }
  return safeSeconds * 1000;
}

const pollIntervalMs = getPollIntervalMs();

// Interface pelacakan lagu dalam memori
interface TrackingTrack {
  artist: string;
  title: string;
  startedAt: any; // Firestore Timestamp
}

let lastTrack: TrackingTrack | null = null;
let isSyncing = false; // Lock Polling untuk mencegah Overlapping

// Fungsi helper menulis log audit secara aman ke Firestore
async function writeAuditLog(action: string, details: string, level: 'info' | 'error' = 'info', result: 'success' | 'failed' | 'skipped' = 'success') {
  try {
    const auditData: FirestoreAuditLog = {
      action,
      mode: 'system',
      gatewayId,
      requestedAt: Timestamp.now(),
      result,
      details: { message: details, level }
    };
    await addDocument('radiobossAuditLogs', auditData);
  } catch (err) {
    Logger.error(`[AuditLog] Gagal menulis log audit ke Firestore: ${String(err)}`);
  }
}

// Mengambil program aktif saat ini jika ada, fallback ke Program tidak tersinkron
async function getActiveProgram() {
  try {
    const doc = await db.collection('activeProgram').doc('current').get();
    if (doc.exists) {
      const data = doc.data();
      if (data && data.programTitle) {
        return {
          id: data.programId || null,
          title: data.programTitle
        };
      }
    }
  } catch (err) {
    // Abaikan error koneksi pembacaan dan kembali ke fallback default
  }
  // Tidak memakai hardcode fallback program "Aga Kareba"
  return {
    id: null,
    title: 'Program tidak tersinkron'
  };
}

// Inisialisasi lastTrack dari data lagu yang sedang diputar di Firestore saat startup agen
export async function initializeLastTrack() {
  try {
    const doc = await db.collection('radiobossNowPlaying').doc('current').get();
    if (doc.exists) {
      const data = doc.data();
      if (data && (data.artist || data.title)) {
        lastTrack = {
          artist: data.artist || '',
          title: data.title || '',
          startedAt: data.updatedAt || Timestamp.now()
        };
        Logger.info(`[Sync] Inisialisasi lagu terakhir dari Firestore: "${lastTrack.artist} - ${lastTrack.title}"`);
      }
    }
  } catch (err) {
    Logger.warn(`[Sync] Gagal inisialisasi lagu terakhir dari Firestore, akan diinisialisasi pada polling pertama: ${String(err)}`);
  }
}

// Mengubah galat mentah menjadi kode eror ramah pengguna (Safe Error Mapping)
function toSafeError(error: unknown): { errorCode: string; errorMessageSafe: string } {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('AbortError') || message.toLowerCase().includes('timed out') || message.toLowerCase().includes('timeout')) {
    return {
      errorCode: 'RADIOBOSS_TIMEOUT',
      errorMessageSafe: 'Koneksi ke API Remote Control RadioBOSS melampaui batas waktu respons (timeout).'
    };
  }

  if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
    return {
      errorCode: 'RADIOBOSS_CONNECTION_REFUSED',
      errorMessageSafe: 'Gagal terhubung ke RadioBOSS. Pastikan aplikasi RadioBOSS aktif dan Remote Control API diaktifkan.'
    };
  }

  return {
    errorCode: 'GATEWAY_SYNC_FAILED',
    errorMessageSafe: 'Gateway gagal melakukan sinkronisasi data dengan API RadioBOSS.'
  };
}

// Fungsi utama sinkronisasi agen dengan API RadioBOSS
export async function syncRadioBoss() {
  const started = Date.now();
  try {
    const xml = await fetchPlaybackInfoFromRadioBoss();
    const playback = parsePlaybackInfo(xml);
    const normalized = normalizePlayback(playback);

    const latencyMs = Date.now() - started;

    // 1. Perbarui radiobossStatus/current
    const statusData: FirestoreRadiobossStatus = {
      online: true,
      gatewayOnline: true,
      playerState: normalized.playerState,
      lastSyncAt: Timestamp.now(),
      latencyMs,
      errorCode: null,
      errorMessageSafe: null,
      source: 'studio_gateway_agent',
      gatewayId
    };
    await setDocument('radiobossStatus', 'current', statusData);

    // 2. Perbarui radiobossNowPlaying/current
    const nowPlayingData: FirestoreNowPlaying = {
      artist: normalized.current.artist,
      title: normalized.current.title,
      castTitle: normalized.current.castTitle,
      album: normalized.current.album,
      durationSeconds: normalized.current.durationSeconds,
      positionSeconds: normalized.current.positionSeconds,
      progressPercent: normalized.current.progressPercent,
      nextArtist: normalized.next.artist,
      nextTitle: normalized.next.title,
      nextCastTitle: normalized.next.castTitle,
      updatedAt: Timestamp.now(),
      source: 'radioboss_remote_api',
      gatewayId
    };
    await setDocument('radiobossNowPlaying', 'current', nowPlayingData);

    // 3. Catat riwayat lagu jika ada lagu baru yang diputar (dengan penyaringan duplikat ketat)
    const currentArtist = normalized.current.artist;
    const currentTitle = normalized.current.title;

    // Filter validitas metadata
    const isTitleEmpty = !currentTitle || currentTitle.trim() === '';
    const isFallbackOnly = currentTitle === 'Radio SBL Live' && (!currentArtist || currentArtist.trim() === '');

    if (!isTitleEmpty && !isFallbackOnly) {
      if (!lastTrack) {
        lastTrack = {
          artist: currentArtist,
          title: currentTitle,
          startedAt: Timestamp.now()
        };
        Logger.info(`[Sync] Registrasi trek pertama terdeteksi: "${currentArtist} - ${currentTitle}"`);
      } else if (lastTrack.artist !== currentArtist || lastTrack.title !== currentTitle) {
        // Lagu telah berganti!
        const endedAt = Timestamp.now();
        const activeProgram = await getActiveProgram();
        
        // Kalkulasi durasi pemutaran lagu lama
        let durationMs = 0;
        try {
          const startMs = typeof lastTrack.startedAt.toMillis === 'function' ? lastTrack.startedAt.toMillis() : lastTrack.startedAt.getTime();
          const endMs = typeof endedAt.toMillis === 'function' ? endedAt.toMillis() : endedAt.getTime();
          durationMs = endMs - startMs;
        } catch (e) {
          durationMs = 10000; // Fallback jika parsing waktu gagal
        }

        // Limitasi Penulisan Sejarah: Tolak jika perubahan terlalu cepat di bawah 5 detik
        if (durationMs >= 5000) {
          Logger.info(`[Sync] Lagu berganti dari "${lastTrack.artist} - ${lastTrack.title}" ke "${currentArtist} - ${currentTitle}"`);

          const trackHistoryData: FirestoreTrackHistory = {
            artist: lastTrack.artist,
            title: lastTrack.title,
            startedAt: lastTrack.startedAt,
            endedAt,
            durationSeconds: Math.round(durationMs / 1000),
            programId: activeProgram.id,
            programTitle: activeProgram.title,
            source: 'radioboss_remote_api',
            gatewayId,
            createdAt: Timestamp.now()
          };
          
          await addDocument('radiobossTrackHistory', trackHistoryData);

          // Tulis log audit untuk pergantian trek baru
          await writeAuditLog(
            'track_change', 
            `Lagu berganti ke "${currentArtist} - ${currentTitle}" (Sebelumnya: "${lastTrack.artist} - ${lastTrack.title}")`
          );
        } else {
          Logger.warn(`[Sync] Pergantian lagu terlalu cepat (${durationMs / 1000} detik). Menolak penulisan sejarah untuk menghindari spam.`);
        }

        // Perbarui data pelacakan dalam memori
        lastTrack = {
          artist: currentArtist,
          title: currentTitle,
          startedAt: endedAt
        };
      }
    }

    // 4. Perbarui detak jantung gateway (Gateway Heartbeat)
    await updateGatewayHeartbeat({
      status: 'online',
      lastSeenAt: Timestamp.now()
    });

  } catch (error: any) {
    const safeErr = toSafeError(error);
    Logger.error(`[Sync] Error saat proses sinkronisasi: ${error.message || String(error)}`);
    
    // Perbarui status pemutar ke offline dengan safe error
    try {
      const offlineStatus: FirestoreRadiobossStatus = {
        online: false,
        gatewayOnline: true,
        playerState: 'unknown',
        lastSyncAt: Timestamp.now(),
        latencyMs: 0,
        errorCode: safeErr.errorCode,
        errorMessageSafe: safeErr.errorMessageSafe,
        source: 'studio_gateway_agent',
        gatewayId
      };
      await setDocument('radiobossStatus', 'current', offlineStatus);

      // Detak jantung gateway tetap berjalan mandiri
      await updateGatewayHeartbeat({
        status: 'online',
        lastSeenAt: Timestamp.now()
      });

      await writeAuditLog('sync_error', `Sinkronisasi gagal: ${safeErr.errorMessageSafe}`, 'error', 'failed');
    } catch (dbErr) {
      Logger.error(`[Sync] Gagal menulis status error ke Firestore: ${String(dbErr)}`);
    }
  }
}

// Fungsi helper memperbarui heartbeat gateway
async function updateGatewayHeartbeat(options: { status: 'online' | 'offline'; lastSeenAt: any }) {
  try {
    const heartbeatData: FirestoreGatewayHeartbeat = {
      gatewayId,
      gatewayName,
      pcName,
      status: options.status,
      mode: 'read_only',
      appVersion,
      lastSeenAt: options.lastSeenAt
    };
    await setDocument('radiobossGatewayHeartbeat', gatewayId, heartbeatData);
  } catch (err) {
    Logger.error(`[Heartbeat] Gagal update heartbeat ke Firestore: ${String(err)}`);
  }
}

// Central Sync Loop dengan pengamanan Lock agar tidak Overlap
async function safeSyncRadioBoss() {
  if (isSyncing) {
    Logger.warn('[Agent] Polling berikutnya dilewati karena proses sinkronisasi sebelumnya masih berjalan.');
    return;
  }

  isSyncing = true;
  try {
    await syncRadioBoss();
  } finally {
    isSyncing = false;
  }
}

// Memulai Gateway Agent
async function startAgent() {
  Logger.info('==================================================');
  Logger.info('   RadioBOSS Firestore Gateway Agent Starting     ');
  Logger.info(`   Gateway ID:   ${gatewayId}`);
  Logger.info(`   Gateway Name: ${gatewayName}`);
  Logger.info(`   PC Name:      ${pcName}`);
  Logger.info(`   Version:      ${appVersion}`);
  Logger.info(`   Interval:     ${pollIntervalMs / 1000} detik`);
  Logger.info('==================================================');

  // Menulis log startup awal ke Firestore
  try {
    await updateGatewayHeartbeat({
      status: 'online',
      lastSeenAt: Timestamp.now()
    });

    const startupLog: FirestoreAuditLog = {
      action: 'agent_start',
      mode: 'system',
      gatewayId,
      requestedAt: Timestamp.now(),
      result: 'success',
      details: { message: `Gateway agent berhasil dijalankan pada PC ${pcName}` }
    };
    await addDocument('radiobossAuditLogs', startupLog);
  } catch (err) {
    Logger.error(`Gagal mencatat startup awal ke Firestore: ${String(err)}`);
  }

  // Inisialisasi data lagu terakhir dari Firestore
  await initializeLastTrack();

  // Jalankan sinkronisasi pertama kali secara langsung
  Logger.info('[Agent] Melakukan sinkronisasi pertama...');
  await safeSyncRadioBoss();

  // Jadwalkan sinkronisasi berkala yang terproteksi oleh sync lock
  Logger.info(`[Agent] Menjadwalkan sinkronisasi berkala setiap ${pollIntervalMs / 1000} detik.`);
  setInterval(safeSyncRadioBoss, pollIntervalMs);
}

// 2. Mengimplementasikan Graceful Shutdown (SIGINT & SIGTERM)
async function gracefulShutdown(signal: string) {
  Logger.info(`[Agent] Menerima sinyal ${signal}. Memulai penutupan gateway secara normal...`);
  
  try {
    // Update status detak jantung ke offline sebelum keluar
    await updateGatewayHeartbeat({
      status: 'offline',
      lastSeenAt: Timestamp.now()
    });

    // Catat log audit penutupan agen
    const shutdownLog: FirestoreAuditLog = {
      action: 'agent_stop',
      mode: 'system',
      gatewayId,
      requestedAt: Timestamp.now(),
      result: 'success',
      details: { message: `Gateway agent berhasil ditutup secara normal melalui sinyal ${signal}` }
    };
    await addDocument('radiobossAuditLogs', shutdownLog);
    
    Logger.info('[Agent] Detak jantung offline berhasil diperbarui. Mengakhiri proses.');
  } catch (err) {
    Logger.error(`[Agent] Gagal memperbarui status penutupan ke Firestore: ${String(err)}`);
  } finally {
    process.exit(0);
  }
}

// Registrasi listener graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startAgent().catch((err) => {
  Logger.error(`[Agent] Fatal error saat agen mulai berjalan: ${String(err)}`);
  process.exit(1);
});
