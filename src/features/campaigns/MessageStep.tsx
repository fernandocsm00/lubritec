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
import type { AudienceFilters } from './types';

interface Props {
  templateId: string | null;
  onTemplateIdChange: (v: string | null) => void;
  messageBody: string;
  onMessageBodyChange: (v: string) => void;
  mediaUrl: string | null;
  mediaMime: string | null;
  onMediaChange: (url: string | null, mime: string | null) => void;
  audienceFilter: AudienceFilters;
}

export function MessageStep(p: Props) {
  const { data: templates } = useTemplates();
  const dryRun = useDryRun();
  const [previewLead, setPreviewLead] = useState<{
    name: string; phone: string;
    vehicleModel: string | null; vehiclePlate: string | null;
    lastPurchaseDate: string | null;
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
            vehicleModel: first.vehicleModel,
            vehiclePlate: first.vehiclePlate,
            lastPurchaseDate: first.lastPurchaseDate,
          });
        }
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            placeholder="Olá {{nome}}, sua última troca foi em {{ultima_compra}}…"
            rows={8}
            maxLength={4000}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Placeholders disponíveis: <code>{'{{nome}}'}</code>, <code>{'{{telefone}}'}</code>,{' '}
            <code>{'{{placa}}'}</code>, <code>{'{{modelo}}'}</code>, <code>{'{{ultima_compra}}'}</code>
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
                  vehicleModel: found.vehicleModel,
                  vehiclePlate: found.vehiclePlate,
                  lastPurchaseDate: found.lastPurchaseDate,
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
