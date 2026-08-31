import { Router } from 'express';
import multer from 'multer';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import { multerCampaignMedia } from '../middleware/multerCampaignMedia';
import { multerCsv } from '../middleware/multerCsv';
import {
  listHandler,
  getHandler,
  dryRunHandler,
  importAudienceHandler,
  enrichAudienceHandler,
  createHandler,
  dispatchHandler,
  pauseHandler,
  resumeHandler,
  cancelHandler,
  deleteHandler,
  recipientsHandler,
  exportCampaignsCsvHandler,
  exportRecipientsCsvHandler,
  uploadMediaHandler,
  aggregateStatsHandler,
  timeseriesHandler,
  topCampaignsHandler,
  reportCitiesHandler,
} from '../controllers/campaignsController';
import { listUnqualifiedLeads, getCalibrationMetrics } from '../services/campaignsService';
import {
  getHandler as continuousGetHandler,
  upsertHandler as continuousUpsertHandler,
} from '../controllers/continuousCampaignController';

const router = Router();
const guard = [authGuard, requireRole('admin', 'comercial')];
const adminOnly = [authGuard, requireRole('admin')];

router.get('/continuous', ...guard, continuousGetHandler);
router.put('/continuous', ...adminOnly, continuousUpsertHandler);
router.get('/aggregate-stats', ...guard, aggregateStatsHandler);
router.get('/timeseries', ...guard, timeseriesHandler);
router.get('/top', ...guard, topCampaignsHandler);
router.get('/report-cities', ...guard, reportCitiesHandler);

// export.csv ANTES de '/:id' — senão o Express casaria 'export.csv' como um id.
router.get('/export.csv', ...guard, exportCampaignsCsvHandler);

router.get('/', ...guard, listHandler);
router.get('/:id', ...guard, getHandler);
router.get('/:id/recipients', ...guard, recipientsHandler);
router.get('/:id/recipients.csv', ...guard, exportRecipientsCsvHandler);
router.post('/dry-run', ...guard, dryRunHandler);
// Import de audiência por CNPJ (reusa o parser de Cadastros).
router.post(
  '/audience/import',
  ...guard,
  (req, res, next) => {
    multerCsv.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Arquivo muito grande' });
      }
      if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
      if (err) return next(err);
      next();
    });
  },
  importAudienceHandler,
);
router.post('/audience/enrich', ...guard, enrichAudienceHandler);
router.post('/', ...guard, createHandler);
router.post('/:id/dispatch', ...guard, dispatchHandler);
router.post('/:id/pause', ...guard, pauseHandler);
router.post('/:id/resume', ...guard, resumeHandler);
router.post('/:id/cancel', ...guard, cancelHandler);
router.post(
  '/upload-media',
  ...guard,
  (req, res, next) => {
    multerCampaignMedia.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 5MB)' });
      }
      if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
      if (err) return next(err);
      next();
    });
  },
  uploadMediaHandler,
);
router.delete('/:id', ...adminOnly, deleteHandler);

router.get('/:id/unqualified-leads', ...guard, async (req, res, next) => {
  try {
    const items = await listUnqualifiedLeads(req.params.id);
    res.json({ items });
  } catch (e) { next(e); }
});

router.get('/:id/calibration-metrics', ...guard, async (req, res, next) => {
  try {
    const metrics = await getCalibrationMetrics(req.params.id);
    res.json(metrics);
  } catch (e) { next(e); }
});

export default router;
