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
import { AudienceStep } from '@/features/campaigns/AudienceStep';
import { MessageStep } from '@/features/campaigns/MessageStep';
import { ReviewStep } from '@/features/campaigns/ReviewStep';
import { useCreateCampaign, useDispatchCampaign } from '@/features/campaigns/api';
import type { AudienceFilters } from '@/features/campaigns/types';

export default function CampaignNewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Estado do wizard
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [audienceTotal, setAudienceTotal] = useState(0);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaMime, setMediaMime] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const create = useCreateCampaign();
  const dispatch = useDispatchCampaign();

  const canNext = (() => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return audienceTotal > 0;
    if (step === 3) return messageBody.trim().length > 0;
    return true;
  })();

  async function submit() {
    try {
      const created = await create.mutateAsync({
        name,
        description: description || undefined,
        templateId,
        messageBody,
        mediaUrl,
        mediaMime,
        audienceFilter: filters,
        scheduledAt,
      });
      await dispatch.mutateAsync(created.id);
      toast.success(scheduledAt ? 'Campanha agendada.' : 'Campanha disparada — acompanhe abaixo.');
      navigate(`/campanhas/${created.id}`);
    } catch (err: unknown) {
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

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Nova campanha</h1>
        <div className="flex gap-2 mt-3 text-xs">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`flex-1 py-1 text-center border-b-2 ${
                n === step ? 'border-primary text-primary font-semibold'
                : n < step ? 'border-primary/40 text-muted-foreground'
                : 'border-border text-muted-foreground'
              }`}
            >
              {n}. {n === 1 && 'Nome'}{n === 2 && 'Audiência'}{n === 3 && 'Mensagem'}{n === 4 && 'Revisar'}
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
          <AudienceStep
            filters={filters} onFiltersChange={setFilters}
            total={audienceTotal} onTotalChange={setAudienceTotal}
          />
        )}
        {step === 3 && (
          <MessageStep
            templateId={templateId} onTemplateIdChange={setTemplateId}
            messageBody={messageBody} onMessageBodyChange={setMessageBody}
            mediaUrl={mediaUrl} mediaMime={mediaMime}
            onMediaChange={(u, m) => { setMediaUrl(u); setMediaMime(m); }}
            audienceFilter={filters}
          />
        )}
        {step === 4 && (
          <ReviewStep
            scheduledAt={scheduledAt} onScheduledAtChange={setScheduledAt}
            audienceTotal={audienceTotal}
            name={name}
            messageBody={messageBody}
            mediaUrl={mediaUrl}
          />
        )}
      </div>

      <div className="flex justify-between pt-4 border-t mt-4">
        <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
        </Button>
        {step < 4 ? (
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
