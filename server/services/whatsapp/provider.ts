import type { MessageKind, ProviderKind } from '@shared/types';

// ── Status ─────────────────────────────────────────────────────────────────
export type ProviderConnectionStatus =
  | 'disconnected'
  | 'pairing'
  | 'connected'
  | 'error';

export interface ProviderStatus {
  status: ProviderConnectionStatus;
  qrCode: string | null;     // só UazAPI pairing
  phoneNumber: string | null;
  profileName: string | null;
  lastCheckedAt: string;     // ISO
}

// ── Envio ──────────────────────────────────────────────────────────────────
export interface SendTextOpts {
  to: string;
  text: string;
  /** providerMsgId da mensagem citada ("responder citando"), se houver. */
  replyToProviderMsgId?: string | null;
}

export interface SendMediaOpts {
  to: string;
  kind: Exclude<MessageKind, 'text'>;
  mediaUrl: string;
  mediaMime?: string;
  caption?: string;
  replyToProviderMsgId?: string | null;
}

export interface SendTemplateOpts {
  to: string;
  templateName: string;
  language: string;
  variables: Array<{ index: number; value: string }>;
  headerMedia?: { kind: 'image' | 'video' | 'document'; url: string };
}

export interface SendResult {
  providerMsgId: string;
  rawPayload: unknown;
}

// ── Templates HSM (Meta only — UazAPI retorna [] / throws) ─────────────────
export interface TemplateRecord {
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  components: unknown;
  rejectionReason: string | null;
}

export interface TemplateInput {
  name: string;
  language: string;
  category: TemplateRecord['category'];
  components: unknown;
}

// ── Capabilities ───────────────────────────────────────────────────────────
export interface ProviderCapabilities {
  freeFormText: boolean;
  requiresApprovedTemplate: boolean;
  supportsMedia: boolean;
  supportsButtons: boolean;
}

// ── Interface central ──────────────────────────────────────────────────────
export interface WhatsAppProvider {
  readonly kind: ProviderKind;
  readonly instanceId: string;

  getStatus(): Promise<ProviderStatus>;
  connect(): Promise<ProviderStatus>;
  disconnect(): Promise<void>;

  sendText(opts: SendTextOpts): Promise<SendResult>;
  sendMedia(opts: SendMediaOpts): Promise<SendResult>;
  sendTemplate(opts: SendTemplateOpts): Promise<SendResult>;

  listTemplates(): Promise<TemplateRecord[]>;
  createTemplate(input: TemplateInput): Promise<TemplateRecord>;
  deleteTemplate(name: string, language: string): Promise<void>;

  capabilities(): ProviderCapabilities;
}

// ── Erros padronizados ─────────────────────────────────────────────────────
export class ProviderError extends Error {
  constructor(
    public status: number,
    public providerKind: ProviderKind,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class OutOfSessionWindowError extends ProviderError {
  constructor(providerKind: ProviderKind) {
    super(409, providerKind, 'Cliente fora da janela de 24h — use um template aprovado');
    this.name = 'OutOfSessionWindowError';
  }
}

export class TemplatesNotSupportedError extends ProviderError {
  constructor(providerKind: ProviderKind) {
    super(400, providerKind, `Provider ${providerKind} does not support HSM templates`);
    this.name = 'TemplatesNotSupportedError';
  }
}
