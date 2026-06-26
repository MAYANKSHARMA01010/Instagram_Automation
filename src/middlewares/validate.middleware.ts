import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean';
  minLength?: number;
  maxLength?: number;
}

/**
 * Creates a request body validation middleware from a set of rules.
 */
export function validateBody(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];

    for (const rule of rules) {
      const value = (req.body as Record<string, unknown>)[rule.field];

      // Required check
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${rule.field}' is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      // Type check
      if (rule.type && typeof value !== rule.type) {
        errors.push(`Field '${rule.field}' must be of type ${rule.type}`);
        continue;
      }

      // String length checks
      if (rule.type === 'string' && typeof value === 'string') {
        if (rule.minLength !== undefined && value.length < rule.minLength) {
          errors.push(`Field '${rule.field}' must be at least ${rule.minLength} characters`);
        }
        if (rule.maxLength !== undefined && value.length > rule.maxLength) {
          errors.push(`Field '${rule.field}' must be at most ${rule.maxLength} characters`);
        }
      }
    }

    if (errors.length > 0) {
      logger.warn('Request validation failed', { path: req.path, errors });
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
      return;
    }

    next();
  };
}

/**
 * Sanitizes string fields in the request body to prevent injection.
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body as Record<string, unknown>)) {
      const val = (req.body as Record<string, unknown>)[key];
      if (typeof val === 'string') {
        // Strip null bytes and trim whitespace
        (req.body as Record<string, unknown>)[key] = val.replace(/\0/g, '').trim();
      }
    }
  }
  next();
}
