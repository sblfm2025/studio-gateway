import { doc, onSnapshot, getDoc } from "firebase/firestore";
// Asumsikan db diimpor dari konfigurasi firebase lokal aplikasi Anda
// import { db } from './firebaseConfig';

export interface RadioBossStatus {
  online: boolean;
  gatewayOnline: boolean;
  playerState: "playing" | "paused" | "stopped" | "unknown";
  lastSyncAt: any;
  latencyMs: number;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
}

export interface RadioBossNowPlaying {
  artist: string;
  title: string;
  castTitle?: string;
  album?: string;
  durationSeconds?: number;
  positionSeconds?: number;
  progressPercent?: number;
  nextArtist?: string;
  nextTitle?: string;
  updatedAt: any;
}

export interface GatewayHeartbeat {
  gatewayId: string;
  gatewayName: string;
  pcName: string;
  status: "online" | "offline";
  lastSeenAt: any;
}

/**
 * Mendengarkan perubahan Now Playing secara real-time dari Firestore
 * @param db Objek Firestore (db) dari firebaseConfig
 * @param callback Callback yang dipicu setiap kali data Now Playing diperbarui
 */
export function subscribeToNowPlaying(
  db: any,
  callback: (data: RadioBossNowPlaying | null) => void,
) {
  const docRef = doc(db, "radiobossNowPlaying", "current");
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data() as RadioBossNowPlaying);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.error("[Service] Gagal memantau Now Playing:", err);
      callback(null);
    },
  );
}

/**
 * Mendengarkan perubahan Status Teknis secara real-time (Hanya untuk Admin/Studio)
 */
export function subscribeToPlayerStatus(
  db: any,
  callback: (data: RadioBossStatus | null) => void,
) {
  const docRef = doc(db, "radiobossStatus", "current");
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data() as RadioBossStatus);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.error("[Service] Gagal memantau status pemutar:", err);
      callback(null);
    },
  );
}

/**
 * Mendengarkan status detak jantung gateway agent secara real-time (Admin/Studio)
 */
export function subscribeToGatewayHeartbeat(
  db: any,
  gatewayId: string,
  callback: (data: GatewayHeartbeat | null) => void,
) {
  const docRef = doc(db, "radiobossGatewayHeartbeat", gatewayId);
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data() as GatewayHeartbeat);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.error(
        `[Service] Gagal memantau heartbeat gateway ${gatewayId}:`,
        err,
      );
      callback(null);
    },
  );
}
