import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Send, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { NameStep } from '@/features/campaigns/NameStep';
import { InstancePickerStep } from '@/features/campaigns/InstancePickerStep';
import { AudienceStep } from '@/features/campaigns/AudienceStep';
import { MessageStep } from '@/features/campaigns/MessageStep';
import { ReviewStep } from '@/features/campaigns/ReviewStep';
import { useCreateCampaign, useDispatchCampaign } from '@/features/campaigns/api';
import type { AudienceFilters, CampaignHsmVariable } from '@/features/campaigns/types';
import type { InstanceListItem, HsmTemplateRecord } from '@shared/types';

const STEP_LABELS: Record<number, string> = {
  1: 'Nome',
  2: 'Linha',
  3: 'Audiência',
  4: 'Mensagem',
  5: 'Revisar',
};

const TOTAL_STEPS = 5;

export default function CampaignNewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Step 2 — Instance
  const [selectedInstance, setSelectedInstance] = useState<InstanceListItem | null>(null);

  // Step 3 — Audience
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [audienceTotal, setAudienceTotal] = useState(0);

  // Step 4 — Message (UazAPI free-form)
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaMime, setMediaMime] = useState<string | null>(null);

  // Step 4 — Message (Meta HSM)
  const [hsmTemplateId, setHsmTemplateId] = useState<string | null>(null);
  const [hsmVariables, setHsmVariables] = useState<CampaignHsmVariable[]>([]);
  // Keep HsmTemplateRecord for ReviewStep display (not sent to API directly)
  const [hsmTemplateRecord, setHsmTemplateRecord] = useState<HsmTemplateRecord | null>(null);

  // Step 5 — Review
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const create = useCreateCampaign();
  const dispatch = useDispatchCampaign();

  const isMeta = selectedInstance?.provider === 'meta_cloud';

  // ── Per-step validation ───────────────────────────────────────────────────
  const canNext = (() => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return selectedInstance !== null;
    if (step === 3) return audienceTotal > 0;
    if (step === 4) {
      if (isMeta) {
        if (!hsmTemplateId) return false;
        if (!hsmTemplateRecord) return false;
        // All variable indices covered and no static-empty values
        const bodyComp = hsmTemplateRecord.components.find((c) => c.type === 'BODY');
        if (bodyComp && 'text' in bodyComp) {
          const matches = bodyComp.text.match(/\{\{(\d+)\}\}/g) ?? [];
          const indices = Array.from(new Set(matches)).map((m) => parseInt(m.slice(2, -2), 10));
          for (const idx of indices) {
            const v = hsmVariables.find((x) => x.index === idx);
            if (!v) return false;
            if (v.source === 'static' && v.value.trim() === '') return false;
          }
        }
        return true;
      }
      return messageBody.trim().length > 0;
    }
    return true;
  })();

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    try {
      const created = await create.mutateAsync({
        name,
        description: description || undefined,
        instanceId: selectedInstance!.id,
        templateId: isMeta ? null : templateId,
        hsmTemplateId: isMeta ? hsmTemplateId : null,
        hsmVariables: isMeta ? hsmVariables : undefined,
        messageBody: isMeta ? undefined : messageBody,
        mediaUrl,
        mediaMime,
        audienceFilter: filters,
        scheduledAt,
      });
      await dispatch.mutateAsync(created.id);
      toast.success(scheduledAt ? 'Campanha agendada.' : 'Campanha disparada — acompanhe abaixo.');
      navigate(`/campanhas/${created.id}`);
    } catch {
      toast.error('Falha ao criar campanha.');
    }
  }

  function handleSubmit() {
    if (audienceTotal > 50) {
      setConfirmOpen(true);
    } else {
      submit();
    }
  }

  // ── Handle instance selection (reset HSM state on change) ─────────────────
  function handleSelectInstance(inst: InstanceListItem) {
    if (inst.id !== selectedInstance?.id) {
      setHsmTemplateId(null);
      setHsmVariables([]);
      setHsmTemplateRecord(null);
    }
    setSelectedInstance(inst);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Nova campanha</h1>
        <div className="flex gap-2 mt-3 text-xs">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className={`flex-1 py-1 text-center border-b-2 ${
                n === step ? 'border-primary text-primary font-semibold'
                : n < step ? 'border-primary/40 text-muted-foreground'
                : 'border-border text-muted-foreground'
              }`}
            >
              {n}. {STEP_LABELS[n]}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-4">
        {step === 1 && (
          <NameStep
            name={name} onNameChange={setName}
            description={description} onDescriptionChange={setDescription}
          />
        )}
        {step === 2 && (
          <InstancePickerStep
            selectedInstanceId={selectedInstance?.id ?? null}
            onSelect={handleSelectInstance}
          />
        )}
        {step === 3 && (
          <AudienceStep
            filters={filters} onFiltersChange={setFilters}
            total={audienceTotal} onTotalChange={setAudienceTotal}
          />
        )}
        {step === 4 && (
          <MessageStep
            templateId={templateId} onTemplateIdChange={setTemplateId}
            messageBody={messageBody} onMessageBodyChange={setMessageBody}
            mediaUrl={mediaUrl} mediaMime={mediaMime}
            onMediaChange={(u, m) => { setMediaUrl(u); setMediaMime(m); }}
            audienceFilter={filters}
            instanceProvider={selectedInstance?.provider}
            instanceId={selectedInstance?.id}
            hsmTemplateId={hsmTemplateId}
            setHsmTemplateId={setHsmTemplateId}
            hsmVariables={hsmVariables}
            setHsmVariables={setHsmVariables}
            onHsmTemplateSelect={setHsmTemplateRecord}
          />
        )}
        {step === 5 && (
          <ReviewStep
            scheduledAt={scheduledAt} onScheduledAtChange={setScheduledAt}
            audienceTotal={audienceTotal}
            name={name}
            messageBody={messageBody}
            mediaUrl={mediaUrl}
            selectedInstance={selectedInstance}
            hsmTemplate={hsmTemplateRecord}
            hsmVariables={hsmVariables}
          />
        )}
      </div>

      <div className="flex justify-between pt-4 border-t mt-4">
        <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
        </Button>
        {step < TOTAL_STEPS ? (
          <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            Próximo <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={create.isPending || dispatch.isPending}
          >
            <Send className="h-4 w-4 mr-1" />
            {scheduledAt ? 'Agendar disparo' : 'Disparar agora'}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirmar disparo em massa
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm">
                Você vai disparar pra <strong>{audienceTotal}</strong> leads.{' '}
                {scheduledAt
                  ? 'Esta campanha será disparada na data agendada.'
                  : 'Esta ação será executada em ~' + Math.ceil(audienceTotal / 20) + ' minutos. Não pode ser desfeita por completo.'}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); submit(); }}>
              Confirmar disparo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
