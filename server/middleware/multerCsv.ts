import multer from 'multer';
import type { Request } from 'express';

const ALLOWED_MIMES = new Set([
  'text/csv',
  'application/vnd.ms-excel',                                                // .xls / generic Excel
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'application/csv',
  'text/plain',
  'application/octet-stream',  // navegadores as vezes mandam isso pra .xlsx
]);

export const multerCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
    else cb(null, false);
  },
});
