import * as os from 'os';
import dotenv from 'dotenv';
import { db, Timestamp } from './firebaseClient';
import { fetchPlaybackInfoFromRadioBoss } from './radiobossClient';
import { parsePlaybackInfo } from './parsePlaybackInfo';
import { normalizePlayback } from './normalizeTrack';
import { Logger } from './logger';

dotenv.config();

export const gatewayId = process.env.GATEWAY_ID || 'studio-main';
const pollIntervalSec = parseInt(process.env.POLL_INTERVAL_SECONDS || '10', 10);
const pollIntervalMs = pollIntervalSec * 1000;
export const appVersion = '1.0.0';
export const pcName = os.hostname() || 'STUDIO-SBL';

// Interface pelacakan lagu dalam memori
interface TrackingTrack {
  artist: string;
  title: string;
  startedAt: any; // Firestore Timestamp
}

let lastTrack: TrackingTrack | null = null;

// Fungsi helper menulis log audit secara aman ke Firestore
async function writeAuditLog(action: string, details: string, level: 'info' | 'error' = 'info') {
  try {
    await db.collection('radiobossAuditLogs').add({
      gatewayId,
      action,
      details,
      level,
      timestamp: Timestamp.now()
    });
  } catch (err) {
    Logger.error(`[AuditLog] Gagal menulis log audit ke Firestore: ${String(err)}`);
  }
}

// Mengambil program aktif saat ini jika ada, fallback ke nilai default
async function getActiveProgram() {
  try {
    // Mencoba mencari data program aktif saat ini di Firestore (jika diintegrasikan nanti)
    const doc = await db.collection('activeProgram').doc('current').get();
    if (doc.exists) {
      const data = doc.data();
      return {
        id: data?.programId || 'program-aktif',
        title: data?.programTitle || 'Aga Kareba'
      };
    }
  } catch (err) {
    // Abaikan error dan kembali ke fallback default
  }
  return {
    id: 'program-aktif',
    title: 'Aga Kareba'
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

// Fungsi utama sinkronisasi agen dengan API RadioBOSS
export async function syncRadioBoss() {
  const started = Date.now();
  try {
    const xml = await fetchPlaybackInfoFromRadioBoss();
    const playback = parsePlaybackInfo(xml);
    const normalized = normalizePlayback(playback);

    const latencyMs = Date.now() - started;

    // 1. Perbarui radiobossStatus/current
    await db.collection('radiobossStatus').doc('current').set({
      online: true,
      gatewayOnline: true,
      playerState: normalized.playerState,
      lastSyncAt: Timestamp.now(),
      latencyMs,
      errorMessage: null,
      source: 'studio_gateway_agent'
    }, { merge: true });

    // 2. Perbarui radiobossNowPlaying/current
    await db.collection('radiobossNowPlaying').doc('current').set({
      artist: normalized.current.artist,
      title: normalized.current.title,
      album: normalized.current.album,
      durationSeconds: normalized.current.durationSeconds,
      positionSeconds: normalized.current.positionSeconds,
      progressPercent: normalized.current.progressPercent,
      nextArtist: normalized.next.artist,
      nextTitle: normalized.next.title,
      updatedAt: Timestamp.now(),
      source: 'radioboss_remote_api'
    });

    // 3. Catat riwayat lagu jika ada lagu baru yang diputar
    const currentArtist = normalized.current.artist;
    const currentTitle = normalized.current.title;

    if (currentArtist || currentTitle) {
      if (!lastTrack) {
        // Deteksi trek pertama saat agen berjalan
        lastTrack = {
          artist: currentArtist,
          title: currentTitle,
          startedAt: Timestamp.now()
        };
        Logger.info(`[Sync] Registrasi lagu pertama: "${currentArtist} - ${currentTitle}"`);
      } else if (lastTrack.artist !== currentArtist || lastTrack.title !== currentTitle) {
        // Lagu telah berganti!
        const endedAt = Timestamp.now();
        const activeProgram = await getActiveProgram();
        
        Logger.info(`[Sync] Lagu berganti dari "${lastTrack.artist} - ${lastTrack.title}" ke "${currentArtist} - ${currentTitle}"`);

        // Simpan lagu lama yang sudah selesai diputar ke radiobossTrackHistory
        const trackHistoryDoc = db.collection('radiobossTrackHistory').doc();
        await trackHistoryDoc.set({
          artist: lastTrack.artist,
          title: lastTrack.title,
          startedAt: lastTrack.startedAt,
          endedAt,
          programId: activeProgram.id,
          programTitle: activeProgram.title,
          source: 'radioboss_remote_api'
        });

        // Tulis log audit untuk transisi trek baru
        await writeAuditLog(
          'track_change', 
          `Lagu berganti ke "${currentArtist} - ${currentTitle}" (Sebelumnya: "${lastTrack.artist} - ${lastTrack.title}")`
        );

        // Perbarui data pelacakan dalam memori
        lastTrack = {
          artist: currentArtist,
          title: currentTitle,
          startedAt: endedAt // Waktu mulai lagu baru adalah waktu selesai lagu lama
        };
      }
    }

    // 4. Perbarui detak jantung gateway (Gateway Heartbeat)
    await db.collection('radiobossGatewayHeartbeat').doc(gatewayId).set({
      gatewayId,
      status: 'online',
      mode: 'read_only',
      appVersion,
      pcName,
      lastSeenAt: Timestamp.now()
    }, { merge: true });

  } catch (error: any) {
    const errorMsg = error.message || String(error);
    Logger.error(`[Sync] Error saat proses sinkronisasi: ${errorMsg}`);
    
    // Perbarui status pemutar ke offline namun agen gateway tetap online
    try {
      await db.collection('radiobossStatus').doc('current').set({
        online: false,
        gatewayOnline: true,
        playerState: 'unknown',
        lastSyncAt: Timestamp.now(),
        errorMessage: errorMsg,
        source: 'studio_gateway_agent'
      }, { merge: true });

      // Detak jantung gateway tetap berjalan mandiri
      await db.collection('radiobossGatewayHeartbeat').doc(gatewayId).set({
        gatewayId,
        status: 'online',
        mode: 'read_only',
        appVersion,
        pcName,
        lastSeenAt: Timestamp.now()
      }, { merge: true });

      await writeAuditLog('sync_error', `Sinkronisasi gagal: ${errorMsg}`, 'error');
    } catch (dbErr) {
      Logger.error(`[Sync] Gagal menulis status error ke Firestore: ${String(dbErr)}`);
    }
  }
}

// Memulai Gateway Agent
async function startAgent() {
  Logger.info('==================================================');
  Logger.info('   RadioBOSS Firestore Gateway Agent Starting     ');
  Logger.info(`   Gateway ID: ${gatewayId}`);
  Logger.info(`   PC Name:    ${pcName}`);
  Logger.info(`   Version:    ${appVersion}`);
  Logger.info(`   Interval:   ${pollIntervalSec} detik`);
  Logger.info('==================================================');

  // Menulis log startup awal ke Firestore
  try {
    await db.collection('radiobossGatewayHeartbeat').doc(gatewayId).set({
      gatewayId,
      status: 'online',
      mode: 'read_only',
      appVersion,
      pcName,
      lastSeenAt: Timestamp.now()
    }, { merge: true });

    await db.collection('radiobossAuditLogs').add({
      gatewayId,
      action: 'agent_start',
      details: `Gateway agent berhasil dijalankan pada PC ${pcName}`,
      level: 'info',
      timestamp: Timestamp.now()
    });
  } catch (err) {
    Logger.error(`Gagal mencatat startup awal ke Firestore: ${String(err)}`);
  }

  // Inisialisasi data lagu terakhir dari Firestore
  await initializeLastTrack();

  // Jalankan sinkronisasi pertama kali secara langsung
  Logger.info('[Agent] Melakukan sinkronisasi pertama...');
  await syncRadioBoss();

  // Jadwalkan sinkronisasi berkala menggunakan setInterval
  Logger.info(`[Agent] Menjadwalkan sinkronisasi berkala setiap ${pollIntervalSec} detik.`);
  setInterval(async () => {
    Logger.info('[Agent] Melakukan polling berkala...');
    await syncRadioBoss();
  }, pollIntervalMs);
}

startAgent().catch((err) => {
  Logger.error(`[Agent] Fatal error saat agen mulai berjalan: ${String(err)}`);
  process.exit(1);
});
