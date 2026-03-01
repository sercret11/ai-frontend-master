/**
 * Frontend logger utility.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string = '', level: LogLevel = LogLevel.INFO) {
    this.prefix = prefix;
    this.level = process.env['NODE_ENV'] === 'production' ? LogLevel.ERROR : level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    return `${timestamp} ${prefix}[${level}] ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    if (process.env['NODE_ENV'] === 'development') {
      console.debug(this.formatMessage('DEBUG', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    console.info(this.formatMessage('INFO', message), ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    console.warn(this.formatMessage('WARN', message), ...args);
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    console.error(this.formatMessage('ERROR', message), ...args);
  }
}

export const logger = new Logger('Frontend');
