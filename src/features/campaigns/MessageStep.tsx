import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useTemplates } from '@/features/whatsapp/api';
import { useDryRun } from './api';
import { MediaUpload } from './MediaUpload';
import { PreviewMessage } from './PreviewMessage';
import { HsmTemplatePickerStep } from './HsmTemplatePickerStep';
import { HsmVariablesMapper } from './HsmVariablesMapper';
import type { AudienceFilters, CampaignHsmVariable } from './types';
import type { HsmTemplateRecord } from '@shared/types';

export interface MessageStepProps {
  templateId: string | null;
  onTemplateIdChange: (v: string | null) => void;
  messageBody: string;
  onMessageBodyChange: (v: string) => void;
  mediaUrl: string | null;
  mediaMime: string | null;
  onMediaChange: (url: string | null, mime: string | null) => void;
  audienceFilter: AudienceFilters;
  // HSM / instance branching (optional — default is UazAPI free-form)
  instanceProvider?: 'uazapi' | 'meta_cloud';
  instanceId?: string;
  hsmTemplateId: string | null;
  setHsmTemplateId: (id: string | null) => void;
  hsmVariables: CampaignHsmVariable[];
  setHsmVariables: (vars: CampaignHsmVariable[]) => void;
  // Called when a full HSM template record is selected (for ReviewStep display)
  onHsmTemplateSelect?: (tpl: HsmTemplateRecord) => void;
}

export function MessageStep(p: MessageStepProps) {
  if (p.instanceProvider === 'meta_cloud') {
    return <MetaHsmMessageStep {...p} />;
  }
  return <FreeFormMessageStep {...p} />;
}

// ── Meta HSM flow ─────────────────────────────────────────────────────────────

function MetaHsmMessageStep(p: MessageStepProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<HsmTemplateRecord | null>(null);

  const handleSelectTemplate = (tpl: HsmTemplateRecord) => {
    setSelectedTemplate(tpl);
    p.setHsmTemplateId(tpl.id);
    p.onHsmTemplateSelect?.(tpl);
    // Reset variable mapping when template changes
    p.setHsmVariables([]);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="text-sm font-medium text-zinc-700 mb-3">Template HSM</div>
        <HsmTemplatePickerStep
          instanceId={p.instanceId!}
          selectedTemplateId={p.hsmTemplateId}
          onSelect={handleSelectTemplate}
        />
      </div>
      {selectedTemplate && (
        <div>
          <div className="text-sm font-medium text-zinc-700 mb-3">Variáveis</div>
          <HsmVariablesMapper
            template={selectedTemplate}
            variables={p.hsmVariables}
            onChange={p.setHsmVariables}
          />
        </div>
      )}
    </div>
  );
}

// ── UazAPI free-form flow ──────────────────────────────────────────────────────

function FreeFormMessageStep(p: MessageStepProps) {
  const { data: templates } = useTemplates();
  const dryRun = useDryRun();
  const [previewLead, setPreviewLead] = useState<{
    name: string; phone: string; cnpj: string | null;
  } | null>(null);

  // Carrega 5 leads de preview da audiência atual
  useEffect(() => {
    dryRun.mutate(p.audienceFilter, {
      onSuccess: (r) => {
        if (r.preview.length > 0) {
          const first = r.preview[0];
          setPreviewLead({
            name: first.name,
            phone: first.phone,
            cnpj: first.cnpj,
          });
        }
      },
    });
  // Re-fetch when audience filter changes (stringified to defeat referential
  // inequality on nested arrays); dryRun.mutate identity is stable across renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(p.audienceFilter)]);

  const previews = useMemo(() => dryRun.data?.preview ?? [], [dryRun.data]);

  return (
    <div className="grid grid-cols-2 gap-6 max-w-5xl">
      <div className="space-y-4">
        <div>
          <Label>Template (opcional, ponto de partida)</Label>
          <Select
            value={p.templateId ?? 'none'}
            onValueChange={(v) => {
              if (v === 'none') {
                p.onTemplateIdChange(null);
                return;
              }
              p.onTemplateIdChange(v);
              const t = templates?.items.find((x) => x.id === v);
              if (t) p.onMessageBodyChange(t.body);
            }}
          >
            <SelectTrigger><SelectValue placeholder="Sem template" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— sem template —</SelectItem>
              {templates?.items.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Mensagem *</Label>
          <Textarea
            value={p.messageBody}
            onChange={(e) => p.onMessageBodyChange(e.target.value)}
            placeholder="Olá {{nome}}, temos uma proposta especial para a {{cnpj}}…"
            rows={8}
            maxLength={4000}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Placeholders disponíveis: <code>{'{{nome}}'}</code>, <code>{'{{telefone}}'}</code>, <code>{'{{cnpj}}'}</code>
          </p>
        </div>

        <div>
          <Label>Imagem (opcional)</Label>
          <MediaUpload
            mediaUrl={p.mediaUrl}
            onChange={p.onMediaChange}
          />
        </div>
      </div>

      <div>
        <Label>Prévia</Label>
        {previews.length > 1 && (
          <Select
            value={previewLead?.phone ?? ''}
            onValueChange={(v) => {
              const found = previews.find((x) => x.phone === v);
              if (found) {
                setPreviewLead({
                  name: found.name,
                  phone: found.phone,
                  cnpj: found.cnpj,
                });
              }
            }}
          >
            <SelectTrigger className="mb-2 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {previews.map((pr) => (
                <SelectItem key={pr.phone} value={pr.phone}>{pr.name} ({pr.phone})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <PreviewMessage body={p.messageBody} mediaUrl={p.mediaUrl} lead={previewLead} />
      </div>
    </div>
  );
}
