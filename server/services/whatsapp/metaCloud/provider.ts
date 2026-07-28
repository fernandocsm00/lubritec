import type {
  WhatsAppProvider,
  ProviderStatus,
  SendTextOpts,
  SendMediaOpts,
  SendTemplateOpts,
  SendResult,
  TemplateRecord,
  TemplateInput,
  ProviderCapabilities,
} from '../provider';
import {
  ProviderError,
  OutOfSessionWindowError,
  TemplatesNotSupportedError,
} from '../provider';
import { decryptSecret } from '../../../lib/crypto';
import type { MetaCloudConfig } from './configSchema';
import {
  getPhoneNumberInfo,
  sendText as graphSendText,
  sendMedia as graphSendMedia,
  isOutOfSessionError,
  MetaGraphError,
} from './client';
import {
  sendTemplateMessage,
  type SendTemplateComponent,
} from './templates';

export class MetaCloudProvider implements WhatsAppProvider {
  readonly kind = 'meta_cloud' as const;

  constructor(
    public readonly instanceId: string,
    private readonly cfg: MetaCloudConfig,
  ) {}

  private decToken(): string {
    return decryptSecret(this.cfg.accessToken);
  }

  async getStatus(): Promise<ProviderStatus> {
    const now = new Date().toISOString();
    try {
      const info = await getPhoneNumberInfo({
        phoneNumberId: this.cfg.phoneNumberId,
        accessToken: this.decToken(),
      });
      return {
        status: 'connected',
        qrCode: null,
        phoneNumber: info.display_phone_number,
        profileName: info.verified_name,
        lastCheckedAt: now,
      };
    } catch {
      return {
        status: 'error',
        qrCode: null,
        phoneNumber: null,
        profileName: null,
        lastCheckedAt: now,
      };
    }
  }

  /** Meta has no "pairing" — connect just refreshes the status. */
  async connect(): Promise<ProviderStatus> {
    return this.getStatus();
  }

  /** Meta has no "logout" — disconnect is a no-op for symmetry with UazAPI. */
  async disconnect(): Promise<void> {
    return;
  }

  async sendText(opts: SendTextOpts): Promise<SendResult> {
    try {
      const res = await graphSendText({
        phoneNumberId: this.cfg.phoneNumberId,
        accessToken: this.decToken(),
        to: opts.to,
        text: opts.text,
        replyToProviderMsgId: opts.replyToProviderMsgId,
      });
      return { providerMsgId: res.messageId, rawPayload: res.rawPayload };
    } catch (err) {
      this.translateAndRethrow(err);
    }
  }

  async sendMedia(opts: SendMediaOpts): Promise<SendResult> {
    // Meta Cloud Graph API only supports concrete media kinds. 'unknown' is a
    // catch-all from the internal schema (e.g. for inbound types we don't yet
    // map) and has no Graph equivalent — reject early with a clear message.
    if (opts.kind === 'unknown') {
      throw new ProviderError(400, 'meta_cloud',
        'Cannot send media of kind "unknown" — specify image, video, audio or document');
    }
    try {
      const res = await graphSendMedia({
        phoneNumberId: this.cfg.phoneNumberId,
        accessToken: this.decToken(),
        to: opts.to,
        kind: opts.kind,
        mediaUrl: opts.mediaUrl,
        caption: opts.caption,
        replyToProviderMsgId: opts.replyToProviderMsgId,
      });
      return { providerMsgId: res.messageId, rawPayload: res.rawPayload };
    } catch (err) {
      this.translateAndRethrow(err);
    }
  }

  async sendTemplate(opts: SendTemplateOpts): Promise<SendResult> {
    const components: SendTemplateComponent[] = [];

    // Header media (optional) — image / video / document
    if (opts.headerMedia) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: opts.headerMedia.kind,
            [opts.headerMedia.kind]: { link: opts.headerMedia.url },
          } as SendTemplateComponent['parameters'][number],
        ],
      });
    }

    // Body variables (ordered by index)
    if (opts.variables.length > 0) {
      const sorted = [...opts.variables].sort((a, b) => a.index - b.index);
      components.push({
        type: 'body',
        parameters: sorted.map((v) => ({ type: 'text' as const, text: v.value })),
      });
    }

    try {
      const res = await sendTemplateMessage({
        phoneNumberId: this.cfg.phoneNumberId,
        accessToken: this.decToken(),
        to: opts.to,
        name: opts.templateName,
        language: opts.language,
        components,
      });
      return { providerMsgId: res.messageId, rawPayload: res.rawPayload };
    } catch (err) {
      this.translateAndRethrow(err);
    }
  }

  private translateAndRethrow(err: unknown): never {
    if (isOutOfSessionError(err)) {
      throw new OutOfSessionWindowError('meta_cloud');
    }
    if (err instanceof MetaGraphError) {
      throw new ProviderError(err.status, 'meta_cloud', err.message, err);
    }
    throw err;
  }

  // ── Templates (HSM, Plan C territory — return stubs) ───────────────────
  async listTemplates(): Promise<TemplateRecord[]> {
    return [];
  }

  async createTemplate(_input: TemplateInput): Promise<TemplateRecord> {
    throw new TemplatesNotSupportedError('meta_cloud');
  }

  async deleteTemplate(_name: string, _language: string): Promise<void> {
    throw new TemplatesNotSupportedError('meta_cloud');
  }

  capabilities(): ProviderCapabilities {
    return {
      freeFormText: true,
      requiresApprovedTemplate: true,
      supportsMedia: true,
      supportsButtons: true,
    };
  }
}
