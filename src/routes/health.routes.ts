import { Router } from 'express';
import { healthCheck, queueStats } from '../controllers/health.controller';

const router = Router();

/**
 * @route  GET /health
 * @desc   Application health check (public — no auth required)
 */
router.get('/', (req, res) => {
  void healthCheck(req, res);
});

/**
 * @route  GET /health/queue
 * @desc   Queue statistics (public)
 */
router.get('/queue', queueStats);

export default router;
