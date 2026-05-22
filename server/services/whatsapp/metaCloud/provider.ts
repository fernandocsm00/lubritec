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
      });
      return { providerMsgId: res.messageId, rawPayload: res.rawPayload };
    } catch (err) {
      this.translateAndRethrow(err);
    }
  }

  async sendMedia(opts: SendMediaOpts): Promise<SendResult> {
    try {
      const res = await graphSendMedia({
        phoneNumberId: this.cfg.phoneNumberId,
        accessToken: this.decToken(),
        to: opts.to,
        kind: opts.kind,
        mediaUrl: opts.mediaUrl,
        caption: opts.caption,
      });
      return { providerMsgId: res.messageId, rawPayload: res.rawPayload };
    } catch (err) {
      this.translateAndRethrow(err);
    }
  }

  async sendTemplate(_opts: SendTemplateOpts): Promise<SendResult> {
    // HSM templates land in Plan C.
    throw new TemplatesNotSupportedError('meta_cloud');
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
