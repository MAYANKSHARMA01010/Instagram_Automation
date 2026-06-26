import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Global error handling middleware.
 * Catches all unhandled errors from route handlers and returns
 * a consistent JSON error response.
 */
export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error('Unhandled request error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  // Don't expose internal error details in production
  const isProduction = process.env.NODE_ENV === 'production';

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: isProduction ? 'An unexpected error occurred' : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

/**
 * 404 Not Found handler for unmatched routes.
 */
export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `Route ${req.method} ${req.path} does not exist`,
  });
}
