import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import healthRoutes from './health.routes';
import uploadRoutes from './upload.routes';
import webhookRoutes from './webhook.routes';

const router: Router = Router();

/**
 * Public routes (no auth required)
 */
router.use('/health', healthRoutes);

/**
 * Protected routes (require X-API-Key header)
 */
router.use('/api/upload', authMiddleware, uploadRoutes);
router.use('/api/webhook', authMiddleware, webhookRoutes);

export default router;
