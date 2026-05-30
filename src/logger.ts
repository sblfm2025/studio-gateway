import * as fs from 'fs';
import * as path from 'path';

const logFilePath = path.resolve(process.cwd(), 'gateway.log');

export class Logger {
  private static formatMessage(message: string, level: 'INFO' | 'WARN' | 'ERROR'): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  static log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') {
    const formatted = this.formatMessage(message, level);
    
    // Tampilkan di konsol sesuai dengan level log
    if (level === 'ERROR') {
      console.error(formatted);
    } else if (level === 'WARN') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }

    // Tulis secara sinkron (append) ke berkas log lokal gateway.log
    try {
      fs.appendFileSync(logFilePath, formatted + '\n', 'utf8');
    } catch (err) {
      console.error('[Logger] Gagal menulis ke berkas log lokal:', err);
    }
  }

  static info(message: string) {
    this.log(message, 'INFO');
  }

  static warn(message: string) {
    this.log(message, 'WARN');
  }

  static error(message: string) {
    this.log(message, 'ERROR');
  }
}
