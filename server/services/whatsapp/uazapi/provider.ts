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
import { TemplatesNotSupportedError, ProviderError } from '../provider';
import { decryptSecret } from '../../../lib/crypto';
import type { UazapiConfig } from './configSchema';
import {
  getInstanceStatus,
  connectInstance,
  logoutInstance,
  UazapiInstanceError,
} from './instanceClient';
import { sendUazapiMessage, UazapiError } from './client';
import type { MessageKind } from '@shared/types';

interface SendInternal {
  to: string;
  kind: MessageKind;
  text?: string;
  mediaUrl?: string;
  mediaMime?: string;
}

export class UazapiProvider implements WhatsAppProvider {
  readonly kind = 'uazapi' as const;

  constructor(
    public readonly instanceId: string,
    private readonly cfg: UazapiConfig,
  ) {}

  private decToken(): string {
    if (!this.cfg.instanceToken) {
      throw new ProviderError(503, 'uazapi', 'Instance token not configured');
    }
    return decryptSecret(this.cfg.instanceToken);
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.cfg.instanceId || !this.cfg.instanceToken) {
      return {
        status: 'disconnected',
        qrCode: null,
        phoneNumber: null,
        profileName: null,
        lastCheckedAt: new Date().toISOString(),
      };
    }
    try {
      const live = await getInstanceStatus({
        baseUrl: this.cfg.baseUrl,
        token: this.decToken(),
      });
      return {
        status: live.status,
        qrCode: live.qrCode,
        phoneNumber: live.phoneNumber,
        profileName: live.profileName,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof UazapiInstanceError) {
        return {
          status: 'error',
          qrCode: null,
          phoneNumber: null,
          profileName: null,
          lastCheckedAt: new Date().toISOString(),
        };
      }
      throw err;
    }
  }

  /**
   * Triggers UazAPI /instance/connect (pairing). Caller (controller) is
   * responsible for any DB persistence of new tokens/instanceIds returned by
   * init/connect. Provider is stateless — it does not write to the DB.
   */
  async connect(): Promise<ProviderStatus> {
    if (!this.cfg.instanceToken) {
      throw new ProviderError(400, 'uazapi', 'Instance must be initialized by controller first');
    }
    await connectInstance({ baseUrl: this.cfg.baseUrl, token: this.decToken() });
    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    if (!this.cfg.instanceToken) return;
    await logoutInstance({ baseUrl: this.cfg.baseUrl, token: this.decToken() });
  }

  async sendText(opts: SendTextOpts): Promise<SendResult> {
    return this.sendInternal({ to: opts.to, kind: 'text', text: opts.text });
  }

  async sendMedia(opts: SendMediaOpts): Promise<SendResult> {
    return this.sendInternal({
      to: opts.to,
      kind: opts.kind,
      text: opts.caption,
      mediaUrl: opts.mediaUrl,
      mediaMime: opts.mediaMime,
    });
  }

  async sendTemplate(_opts: SendTemplateOpts): Promise<SendResult> {
    // UazAPI has no HSM templates. Caller should resolve free-form template
    // body locally and call sendText() instead.
    throw new TemplatesNotSupportedError('uazapi');
  }

  private async sendInternal(opts: SendInternal): Promise<SendResult> {
    try {
      const res = await sendUazapiMessage(opts);
      return { providerMsgId: res.messageId, rawPayload: res.rawPayload };
    } catch (err) {
      if (err instanceof UazapiError) {
        throw new ProviderError(err.status, 'uazapi', err.message, err);
      }
      throw err;
    }
  }

  async listTemplates(): Promise<TemplateRecord[]> {
    return [];   // UazAPI has no HSM templates
  }

  async createTemplate(_input: TemplateInput): Promise<TemplateRecord> {
    throw new TemplatesNotSupportedError('uazapi');
  }

  async deleteTemplate(_name: string, _language: string): Promise<void> {
    throw new TemplatesNotSupportedError('uazapi');
  }

  capabilities(): ProviderCapabilities {
    return {
      freeFormText: true,
      requiresApprovedTemplate: false,
      supportsMedia: true,
      supportsButtons: false,
    };
  }
}
