import { z } from 'zod';

export const uazapiConfigSchema = z.object({
  baseUrl: z.string().url(),
  instanceId: z.string().nullable(),
  instanceToken: z.string().nullable(),  // encrypted ciphertext if non-null
  webhookSecret: z.string().nullable(),
  webhookUrl: z.string().nullable(),
  webhookSynced: z.boolean(),
});

export type UazapiConfig = z.infer<typeof uazapiConfigSchema>;
