import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware';
import routes from './routes/index';
import logger from './utils/logger';

/**
 * Creates and configures the Express application.
 * Separating this from server.ts allows for easy testing.
 */
export function createApp(): Application {
  const app = express();

  // ── Security middleware ────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disabled for API-only server
    }),
  );

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') ?? false,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'X-API-Key'],
    }),
  );

  // ── Request parsing ────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── HTTP request logging ───────────────────────────────────────────────────
  const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
  app.use(
    morgan(morganFormat, {
      stream: {
        write: (message: string) => {
          logger.debug(message.trim());
        },
      },
    }),
  );

  // ── Static files (cover image) ─────────────────────────────────────────────
  app.use('/public', express.static('public'));

  // ── Temporary files (video serving for Instagram API) ────────────────────
  app.use('/public/tmp', express.static('tmp'));

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/', routes);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use(notFoundMiddleware);

  // ── Global error handler ──────────────────────────────────────────────────
  app.use(errorMiddleware);

  return app;
}
