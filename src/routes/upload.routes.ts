import { Router } from 'express';
import {
  triggerUpload,
  enqueueFile,
  getJobs,
  getJobById,
  getUploadLogs,
  getProcessedFiles,
  getStats,
} from '../controllers/upload.controller';
import { validateBody, sanitizeBody } from '../middlewares/validate.middleware';

const router: Router = Router();

/**
 * @route  POST /api/upload/trigger
 * @desc   Manually trigger a Drive poll and upload cycle
 */
router.post('/trigger', (req, res) => {
  void triggerUpload(req, res);
});

/**
 * @route  POST /api/upload/enqueue
 * @desc   Enqueue a specific Drive file by ID
 * @body   { driveFileId: string }
 */
router.post(
  '/enqueue',
  sanitizeBody,
  validateBody([{ field: 'driveFileId', required: true, type: 'string', minLength: 1 }]),
  (req, res) => {
    void enqueueFile(req, res);
  },
);

/**
 * @route  GET /api/upload/jobs
 * @desc   List upload jobs (optional ?status= filter)
 */
router.get('/jobs', (req, res) => {
  void getJobs(req, res);
});

/**
 * @route  GET /api/upload/jobs/:id
 * @desc   Get a specific upload job by ID
 */
router.get('/jobs/:id', (req, res) => {
  void getJobById(req, res);
});

/**
 * @route  GET /api/upload/logs
 * @desc   Get upload history logs
 */
router.get('/logs', (req, res) => {
  void getUploadLogs(req, res);
});

/**
 * @route  GET /api/upload/processed
 * @desc   Get list of processed (uploaded) Drive files
 */
router.get('/processed', (req, res) => {
  void getProcessedFiles(req, res);
});

/**
 * @route  GET /api/upload/stats
 * @desc   Get queue statistics
 */
router.get('/stats', (req, res) => {
  void getStats(req, res);
});

export default router;
