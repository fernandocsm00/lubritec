import multer from 'multer';

// Memory storage: o upload vai direto pra Buffer e o controller re-encoda pra
// JPEG via sharp antes de gravar no disco. Evita arquivo intermediario invalido
// (e.g. HEIC renomeado pra .png) que depois quebra na UazAPI.
const MAX_SIZE = 5 * 1024 * 1024;

// Aceita qualquer image/*. Confiar no mimetype declarado pelo browser ja foi
// problema (HEIC/AVIF passando como image/png). A validacao real de formato
// fica no controller via sharp.metadata() — se o sharp nao decodificar,
// retornamos 400 com mensagem amigavel.
export const multerCampaignMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});
