import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config';
import logger from '../utils/logger';

/**
 * API key authentication middleware.
 * Protects all internal endpoints from unauthorized access.
 *
 * The API key must be sent in the X-API-Key header.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const config = getConfig();
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== config.app.apiKey) {
    logger.warn('Unauthorized API access attempt', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      hasKey: !!apiKey,
    });

    res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing X-API-Key header',
    });
    return;
  }

  next();
}
