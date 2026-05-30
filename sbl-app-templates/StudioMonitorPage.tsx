import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { StudioMonitor } from './StudioMonitor';
import { useRadioBossNowPlaying } from './useRadioBossNowPlaying';

interface StudioMonitorPageProps {
  db: any; // Firestore instance
}

interface TrackHistoryItem {
  id: string;
  artist: string;
  title: string;
  startedAt: any;
  programTitle?: string;
}

export const StudioMonitorPage: React.FC<StudioMonitorPageProps> = ({ db }) => {
  const { artist, title, nextArtist, nextTitle, progressPercent, isLive } = useRadioBossNowPlaying(db, 'studio-main');
  const [history, setHistory] = useState<TrackHistoryItem[]>([]);

  useEffect(() => {
    if (!db) return;

    // Ambil daftar 10 lagu terakhir dari Firestore secara real-time
    const historyQuery = query(
      collection(db, 'radiobossTrackHistory'),
      orderBy('startedAt', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const items: TrackHistoryItem[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          artist: data.artist || '',
          title: data.title || '',
          startedAt: data.startedAt,
          programTitle: data.programTitle
        });
      });
      setHistory(items);
    }, (err) => {
      console.error('[Page] Gagal memuat riwayat lagu:', err);
    });

    return () => unsubscribe();
  }, [db]);

  return (
    <div style={styles.container}>
      {/* Judul Halaman */}
      <h1 style={styles.mainTitle}>Studio Gateway Dashboard</h1>
      <p style={styles.mainSubtitle}>Panel Pemantauan Real-Time Siaran Radio SBL</p>

      <div style={styles.contentLayout}>
        {/* Kolom Kiri: Now Playing & Riwayat Lagu */}
        <div style={styles.leftCol}>
          {/* Card Now Playing */}
          <div style={styles.nowPlayingCard}>
            <div style={styles.cardHeader}>
              <span style={styles.sectionLabel}>Lagu Sedang Diputar</span>
              {isLive && <span style={styles.livePulse}>● ON AIR (LIVE)</span>}
            </div>

            <h2 style={styles.trackTitle}>{title}</h2>
            <h3 style={styles.trackArtist}>{artist || 'Radio SBL Studio'}</h3>

            {/* Progress Bar */}
            {isLive && (
              <div style={styles.progressContainer}>
                <div style={styles.progressBarBg}>
                  <div style={{ ...styles.progressBarFill, width: `${progressPercent}%` }} />
                </div>
                <span style={styles.progressText}>{progressPercent}% selesai</span>
              </div>
            )}

            {/* Next Track Info */}
            {(nextArtist || nextTitle) && (
              <div style={styles.nextTrackBox}>
                <span style={styles.nextLabel}>Lagu Berikutnya:</span>
                <span style={styles.nextValue}>{nextArtist ? `${nextArtist} - ` : ''}{nextTitle}</span>
              </div>
            )}
          </div>

          {/* Card Riwayat Lagu */}
          <div style={styles.historyCard}>
            <h3 style={styles.historyTitle}>10 Lagu Terakhir Selesai Diputar</h3>
            {history.length === 0 ? (
              <p style={styles.emptyText}>Belum ada riwayat lagu terekam.</p>
            ) : (
              <ul style={styles.historyList}>
                {history.map((item) => (
                  <li key={item.id} style={styles.historyItem}>
                    <div style={styles.historyDetails}>
                      <strong style={styles.historyTrack}>{item.artist ? `${item.artist} - ` : ''}{item.title}</strong>
                      <span style={styles.historyProgram}>{item.programTitle || 'Program tidak tersinkron'}</span>
                    </div>
                    <span style={styles.historyTime}>
                      {item.startedAt ? (
                        new Date(
                          typeof item.startedAt.toMillis === 'function'
                            ? item.startedAt.toMillis()
                            : item.startedAt
                        ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      ) : '-'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Kolom Kanan: Pemantau Teknis Status Gateway */}
        <div style={styles.rightCol}>
          <StudioMonitor db={db} gatewayId="studio-main" />
        </div>
      </div>
    </div>
  );
};

// Vanilla Premium Dark Glassmorphism Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#0B0F19',
    color: '#F8FAFC',
    minHeight: '100vh',
    padding: '40px 24px',
    fontFamily: 'Inter, system-ui, sans-serif'
  },
  mainTitle: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 800,
    letterSpacing: '-0.025em',
    textAlign: 'center'
  },
  mainSubtitle: {
    margin: '6px 0 32px 0',
    fontSize: '14px',
    color: '#94A3B8',
    textAlign: 'center'
  },
  contentLayout: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 0.8fr',
    gap: '24px',
    maxWidth: '1200px',
    margin: '0 auto'
  },
  leftCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  rightCol: {
    display: 'flex',
    flexDirection: 'column'
  },
  nowPlayingCard: {
    backgroundColor: '#1E293B',
    borderRadius: '16px',
    padding: '24px',
    border: '1px solid #334155',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  sectionLabel: {
    fontSize: '11px',
    color: '#38BDF8',
    textTransform: 'uppercase',
    letterSpacing: '0.075em',
    fontWeight: 700
  },
  livePulse: {
    fontSize: '11px',
    color: '#F87171',
    fontWeight: 700,
    animation: 'pulse 1.5s infinite'
  },
  trackTitle: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 700,
    color: '#FFFFFF',
    letterSpacing: '-0.02em'
  },
  trackArtist: {
    margin: '6px 0 20px 0',
    fontSize: '16px',
    color: '#94A3B8',
    fontWeight: 500
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px'
  },
  progressBarBg: {
    flex: 1,
    height: '6px',
    backgroundColor: '#334155',
    borderRadius: '9999px',
    overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
    borderRadius: '9999px',
    transition: 'width 0.5s ease-in-out'
  },
  progressText: {
    fontSize: '12px',
    color: '#94A3B8',
    minWidth: '70px',
    textAlign: 'right'
  },
  nextTrackBox: {
    backgroundColor: '#0F172A',
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid #334155',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  nextLabel: {
    fontSize: '12px',
    color: '#94A3B8',
    fontWeight: 600
  },
  nextValue: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#F8FAFC'
  },
  historyCard: {
    backgroundColor: '#1E293B',
    borderRadius: '16px',
    padding: '24px',
    border: '1px solid #334155'
  },
  historyTitle: {
    margin: '0 0 16px 0',
    fontSize: '16px',
    fontWeight: 700
  },
  emptyText: {
    margin: 0,
    color: '#94A3B8',
    fontSize: '14px',
    textAlign: 'center',
    padding: '20px 0'
  },
  historyList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid #1E293B'
  },
  historyDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  historyTrack: {
    fontSize: '13px',
    color: '#F8FAFC'
  },
  historyProgram: {
    fontSize: '11px',
    color: '#64748B'
  },
  historyTime: {
    fontSize: '12px',
    color: '#94A3B8',
    fontWeight: 500
  }
};
export default StudioMonitorPage;
