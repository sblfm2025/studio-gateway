import dotenv from 'dotenv';

dotenv.config();

const apiUrl = process.env.RADIOBOSS_API_URL || 'http://127.0.0.1:9001';
const password = process.env.RADIOBOSS_API_PASSWORD || '';

export async function fetchPlaybackInfoFromRadioBoss(): Promise<string> {
  const url = new URL(apiUrl);
  url.searchParams.set('pass', password);
  url.searchParams.set('action', 'playbackinfo');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 detik timeout

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal
    });
    
    if (!response.ok) {
      throw new Error(`RadioBOSS API HTTP error! status: ${response.status}`);
    }
    
    const text = await response.text();
    return text;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Connection to RadioBOSS API timed out (5 seconds).');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
