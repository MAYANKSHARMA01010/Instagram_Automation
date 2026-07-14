import winston from 'winston';
import fs from 'fs';
import { maskSensitiveStrings } from './error-sanitizer';

const logDir = process.env.LOG_DIR ?? './logs';
const logLevel = process.env.LOG_LEVEL ?? 'info';

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Layer 2: Custom Winston format that sanitizes any strings or stacks
 * inside the log metadata that might contain proxy credentials.
 */
const sanitizeFormat = winston.format((info) => {
  if (info.message && typeof info.message === 'string') {
    info.message = maskSensitiveStrings(info.message);
  }
  if (info.stack && typeof info.stack === 'string') {
    info.stack = maskSensitiveStrings(info.stack);
  }

  // Clean meta fields if full request configs were accidentally logged
  for (const key of Object.keys(info)) {
    if (key === 'message' || key === 'level' || key === 'timestamp' || key === 'service') continue;

    if (key === 'config' && (info.config as any)?.httpsAgent) {
      delete (info.config as any).httpsAgent;
    }
    if (key === 'request' && (info.request as any)?.socket) {
      delete (info.request as any).socket;
    }

    if (typeof info[key] === 'string') {
      info[key] = maskSensitiveStrings(info[key]);
    }
  }
  return info;
});

/**
 * Custom log format with timestamp, level, and structured message.
 */
const logFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  sanitizeFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.splat(),
  winston.format.json(),
);

/**
 * Console format for development readability.
 */
const consoleFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  sanitizeFormat(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${String(timestamp)}] ${level}: ${String(message)}${metaStr}`;
  }),
);

const transports: winston.transport[] = [];

// Add console transport in non-production environments
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: 'debug',
    }),
  );
} else {
  // In production, still log to console for Docker log collection
  transports.push(
    new winston.transports.Console({
      format: logFormat,
      level: logLevel,
    }),
  );
}

const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: { service: 'instagram-reels-uploader' },
  transports,
  exitOnError: false,
});

export default logger;
