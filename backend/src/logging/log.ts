/**
 * Simple Logger - 简单的日志模块
 *
 * 提供基本的日志功能
 */

import fs from 'fs';
import path from 'path';

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  data?: any;
}

export class Log {
  private static instances = new Map<string, Log>();
  private static logFilePath = process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'backend.log');
  private static fileReady = false;

  private service: string;
  private entries: LogEntry[] = [];

  private constructor(service: string) {
    this.service = service;
  }

  static create(config: { service: string }): Log {
    const { service } = config;
    if (!Log.instances.has(service)) {
      Log.instances.set(service, new Log(service));
    }
    return Log.instances.get(service)!;
  }

  debug(message: string, data?: any) {
    this.log('debug', message, data);
  }

  info(message: string, data?: any) {
    this.log('info', message, data);
  }

  warn(message: string, data?: any) {
    this.log('warn', message, data);
  }

  error(message: string, data?: any) {
    this.log('error', message, data);
  }

  private log(level: LogEntry['level'], message: string, data?: any) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      data,
    };
    this.entries.push(entry);

    const prefix = `[${new Date(entry.timestamp).toISOString()}] [${this.service}] [${level.toUpperCase()}]`;
    const output = `${prefix} ${message}`;

    if (level === 'error') {
      console.error(output, data || '');
    } else if (level === 'warn') {
      console.warn(output, data || '');
    } else {
      console.log(output, data || '');
    }

    this.writeToFile(entry);
  }

  private writeToFile(entry: LogEntry): void {
    try {
      if (!Log.fileReady) {
        fs.mkdirSync(path.dirname(Log.logFilePath), { recursive: true });
        Log.fileReady = true;
      }
      const payload = JSON.stringify({
        ...entry,
        service: this.service,
      });
      fs.appendFileSync(Log.logFilePath, `${payload}\n`, { encoding: 'utf8' });
    } catch (error) {
      // Keep logger non-fatal.
      console.warn('[Log] Failed to persist log entry:', error);
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
  }
}

export function createLogger(service: string): Log {
  return Log.create({ service });
}
