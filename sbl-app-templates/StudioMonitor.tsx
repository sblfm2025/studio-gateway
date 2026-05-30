import React, { useState, useEffect } from 'react';
import { subscribeToPlayerStatus, subscribeToGatewayHeartbeat, RadioBossStatus, GatewayHeartbeat } from './radiobossNowPlaying.service';

interface StudioMonitorProps {
  db: any;
  gatewayId?: string;
}

export const StudioMonitor: React.FC<StudioMonitorProps> = ({ db, gatewayId = 'studio-main' }) => {
  const [status, setStatus] = useState<RadioBossStatus | null>(null);
  const [heartbeat, setHeartbeat] = useState<GatewayHeartbeat | null>(null);
  const [isClientOnline, setIsClientOnline] = useState<boolean>(false);

  useEffect(() => {
    if (!db) return;

    // Subscribe ke status operasional pemutar
    const unsubscribeStatus = subscribeToPlayerStatus(db, (data) => {
      setStatus(data);
    });

    // Subscribe ke detak jantung gateway
    const unsubscribeHeartbeat = subscribeToGatewayHeartbeat(db, gatewayId, (data) => {
      setHeartbeat(data);
      
      if (data) {
        const lastSeenMs = typeof data.lastSeenAt.toMillis === 'function' 
          ? data.lastSeenAt.toMillis() 
          : new Date(data.lastSeenAt).getTime();
        const secondsElapsed = (Date.now() - lastSeenMs) / 1000;
        
        // Tandai offline jika tidak ada detak di atas 60 detik
        setIsClientOnline(secondsElapsed <= 60 && data.status === 'online');
      } else {
        setIsClientOnline(false);
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeHeartbeat();
    };
  }, [db, gatewayId]);

  return (
    <div style={styles.card}>
      {/* Header Panel */}
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Studio Gateway Monitor</h3>
          <p style={styles.subtitle}>ID: {gatewayId} | PC: {heartbeat?.pcName || 'Menghubungkan...'}</p>
        </div>
        
        {/* Badge Koneksi Gateway */}
        <div style={{
          ...styles.badge,
          backgroundColor: isClientOnline ? '#10B981' : '#EF4444'
        }}>
          {isClientOnline ? 'GATEWAY ONLINE' : 'GATEWAY OFFLINE'}
        </div>
      </div>

      <hr style={styles.divider} />

      {/* Grid Informasi Utama */}
      <div style={styles.grid}>
        {/* Indikator Pemutar RadioBOSS */}
        <div style={styles.infoBox}>
          <span style={styles.label}>Status RadioBOSS API</span>
          <div style={styles.valueContainer}>
            <span style={{
              ...styles.dot,
              backgroundColor: (status?.online && isClientOnline) ? '#10B981' : '#EF4444'
            }} />
            <span style={styles.value}>
              {(status?.online && isClientOnline) ? 'Terhubung (Online)' : 'Terputus (Offline)'}
            </span>
          </div>
        </div>

        {/* State Pemutar */}
        <div style={styles.infoBox}>
          <span style={styles.label}>Player State</span>
          <span style={{
            ...styles.value,
            textTransform: 'uppercase',
            color: status?.playerState === 'playing' ? '#10B981' : '#F59E0B'
          }}>
            {isClientOnline ? (status?.playerState || 'UNKNOWN') : 'UNKNOWN'}
          </span>
        </div>

        {/* Latency Sinkronisasi */}
        <div style={styles.infoBox}>
          <span style={styles.label}>Respons Klien (Latency)</span>
          <span style={styles.value}>
            {isClientOnline ? `${status?.latencyMs || 0} ms` : '-'}
          </span>
        </div>

        {/* Pembaruan Terakhir */}
        <div style={styles.infoBox}>
          <span style={styles.label}>Sinkronisasi Terakhir</span>
          <span style={styles.value}>
            {status?.lastSyncAt ? (
              new Date(
                typeof status.lastSyncAt.toMillis === 'function' 
                  ? status.lastSyncAt.toMillis() 
                  : status.lastSyncAt
              ).toLocaleTimeString()
            ) : '-'}
          </span>
        </div>
      </div>

      {/* Tampilan Panel Kesalahan (Fail-safe Error Panel) */}
      {!isClientOnline && (
        <div style={styles.errorPanel}>
          <strong style={styles.errorTitle}>Peringatan Koneksi Studio Terputus</strong>
          <p style={styles.errorText}>
            Aplikasi tidak menerima detak jantung dari gateway di PC Studio dalam 60 detik terakhir. 
            Aplikasi secara otomatis beralih ke mode fallback siaran standar.
          </p>
        </div>
      )}

      {isClientOnline && status?.errorCode && (
        <div style={styles.errorPanel}>
          <strong style={styles.errorTitle}>Kesalahan API Pemutar: {status.errorCode}</strong>
          <p style={styles.errorText}>{status.errorMessageSafe || 'Terjadi kesalahan sinkronisasi eksternal.'}</p>
        </div>
      )}
    </div>
  );
};

// Vanilla Premium Dark CSS Styles
const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
    fontFamily: 'Inter, system-ui, sans-serif',
    maxWidth: '650px',
    margin: '16px auto',
    border: '1px solid #334155'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '-0.025em'
  },
  subtitle: {
    margin: '4px 0 0 0',
    fontSize: '13px',
    color: '#94A3B8'
  },
  badge: {
    padding: '6px 12px',
    borderRadius: '9999px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.05em'
  },
  divider: {
    border: 'none',
    borderTop: '1px solid #334155',
    margin: '16px 0'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
    marginBottom: '8px'
  },
  infoBox: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0F172A',
    padding: '16px',
    borderRadius: '10px',
    border: '1px solid #1E293B'
  },
  label: {
    fontSize: '11px',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '6px'
  },
  valueContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  value: {
    fontSize: '14px',
    fontWeight: 600
  },
  errorPanel: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px dashed #EF4444',
    borderRadius: '10px',
    padding: '16px',
    marginTop: '20px'
  },
  errorTitle: {
    display: 'block',
    fontSize: '13px',
    color: '#F87171',
    fontWeight: 700,
    marginBottom: '4px'
  },
  errorText: {
    margin: 0,
    fontSize: '12px',
    color: '#FCA5A5',
    lineHeight: '1.6'
  }
};
export default StudioMonitor;
