import { z } from 'zod';

// Schema do payload de webhook do UazAPI.
// Conservador: aceitamos eventos não-mensagem com .passthrough() e ignoramos.
export const uazapiInboundSchema = z
  .object({
    event: z.string(),                         // ex: 'message.received'
    instance_id: z.string().optional(),
    message: z
      .object({
        id: z.string(),                        // ID único — usado para idempotência
        from: z.string(),                      // telefone remetente (formato livre)
        type: z
          .enum(['text', 'image', 'audio', 'video', 'document'])
          .or(z.string()),                     // string fallback
        text: z.string().nullish(),
        media_url: z.string().nullish(),
        mimetype: z.string().nullish(),
        timestamp: z
          .union([z.string(), z.number()])
          .transform((v) => {
            // UazAPI manda ou ISO string, ou epoch ms, ou epoch s.
            if (typeof v === 'number') {
              return new Date(v < 1e12 ? v * 1000 : v);
            }
            return new Date(v);
          }),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type UazapiInbound = z.infer<typeof uazapiInboundSchema>;
