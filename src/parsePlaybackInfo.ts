import { XMLParser } from 'fast-xml-parser';

export interface RadioBossPlaybackInfo {
  Playback?: {
    state?: string; // 'play', 'pause', 'stop'
    pos?: string;   // posisi (milidetik)
    len?: string;   // durasi total (milidetik)
  };
  CurrentTrack?: {
    TRACK?: {
      ARTIST?: string;
      TITLE?: string;
      ALBUM?: string;
      [key: string]: any;
    };
  };
  NextTrack?: {
    TRACK?: {
      ARTIST?: string;
      TITLE?: string;
      ALBUM?: string;
      [key: string]: any;
    };
  };
}

// Konfigurasi parser agar membaca atribut XML dengan tepat
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false // Membiarkan string agar diproses konversi secara eksplisit
});

export function parsePlaybackInfo(xmlString: string): RadioBossPlaybackInfo {
  if (!xmlString || xmlString.trim() === '') {
    throw new Error('Response XML RadioBOSS kosong');
  }

  const parsed = parser.parse(xmlString);
  
  // RadioBOSS API biasanya mengembalikan objek root <Info>
  return parsed.Info || parsed || {};
}
