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
import type { UazapiConfig } from './configSchema';

/**
 * STUB — replaced in Task 4 with the real UazAPI client wiring.
 *
 * Returning errors from all I/O methods is intentional: the registry can be
 * exercised by unit tests without touching the live UazAPI surface.
 */
export class UazapiProvider implements WhatsAppProvider {
  readonly kind = 'uazapi' as const;

  constructor(
    public readonly instanceId: string,
    private readonly cfg: UazapiConfig,
  ) {}

  async getStatus(): Promise<ProviderStatus> {
    return {
      status: 'disconnected',
      qrCode: null,
      phoneNumber: null,
      profileName: null,
      lastCheckedAt: new Date().toISOString(),
    };
  }
  async connect(): Promise<ProviderStatus> { return this.getStatus(); }
  async disconnect(): Promise<void> { return; }
  async sendText(_opts: SendTextOpts): Promise<SendResult> {
    throw new ProviderError(501, 'uazapi', 'UazapiProvider stub — Task 4');
  }
  async sendMedia(_opts: SendMediaOpts): Promise<SendResult> {
    throw new ProviderError(501, 'uazapi', 'UazapiProvider stub — Task 4');
  }
  async sendTemplate(_opts: SendTemplateOpts): Promise<SendResult> {
    throw new TemplatesNotSupportedError('uazapi');
  }
  async listTemplates(): Promise<TemplateRecord[]> { return []; }
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

  /** Test-only: exposes cfg for assertions. */
  get _cfg(): UazapiConfig { return this.cfg; }
}
