import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

const dir = path.join(process.cwd(), 'uploads', 'project-feedback');
fs.mkdirSync(dir, { recursive: true });

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 5;

export const multerProjectFeedback = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});
