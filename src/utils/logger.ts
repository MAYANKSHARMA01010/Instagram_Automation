import winston from 'winston';
import fs from 'fs';

const logDir = process.env.LOG_DIR ?? './logs';
const logLevel = process.env.LOG_LEVEL ?? 'info';

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Custom log format with timestamp, level, and structured message.
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

/**
 * Console format for development readability.
 */
const consoleFormat = winston.format.combine(
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
