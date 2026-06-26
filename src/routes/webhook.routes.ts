import { Router } from 'express';
import {
  handleN8nUpload,
  handleN8nStatusCheck,
  handleN8nPublish,
} from '../controllers/webhook.controller';
import { validateBody, sanitizeBody } from '../middlewares/validate.middleware';

const router = Router();

/**
 * @route  POST /api/webhook/n8n/upload
 * @desc   n8n webhook to trigger upload for a specific Drive file
 * @body   { driveFileId: string, driveFileName: string }
 */
router.post(
  '/n8n/upload',
  sanitizeBody,
  validateBody([
    { field: 'driveFileId', required: true, type: 'string', minLength: 1 },
    { field: 'driveFileName', required: true, type: 'string', minLength: 1 },
  ]),
  (req, res) => {
    void handleN8nUpload(req, res);
  },
);

/**
 * @route  POST /api/webhook/n8n/status
 * @desc   n8n webhook to check Instagram container status
 * @body   { jobId: string }
 */
router.post(
  '/n8n/status',
  sanitizeBody,
  validateBody([{ field: 'jobId', required: true, type: 'string', minLength: 1 }]),
  (req, res) => {
    void handleN8nStatusCheck(req, res);
  },
);

/**
 * @route  POST /api/webhook/n8n/publish
 * @desc   n8n webhook to publish a ready Reel container
 * @body   { jobId: string, containerId: string }
 */
router.post(
  '/n8n/publish',
  sanitizeBody,
  validateBody([
    { field: 'jobId', required: true, type: 'string', minLength: 1 },
    { field: 'containerId', required: true, type: 'string', minLength: 1 },
  ]),
  (req, res) => {
    void handleN8nPublish(req, res);
  },
);

export default router;
