import { Router } from 'express';
import { healthCheck, queueStats, todayLogsReport } from '../controllers/health.controller';

const router: Router = Router();

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
router.get('/queue', (req, res) => {
  void queueStats(req, res);
});

/**
 * @route  GET /health/reports/today
 * @desc   Detailed logs of today's uploads (public)
 */
router.get('/reports/today', (req, res) => {
  void todayLogsReport(req, res);
});

export default router;
