import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useTemplates } from '@/features/settings/whatsapp/templates/api';
import { HsmVariablesMapper, detectIndices } from '@/features/campaigns/HsmVariablesMapper';
import type { CampaignHsmVariable, HsmBody } from '@shared/types';
import { useSendConversationTemplate } from './api';

interface Props {
  conversationId: string;
  instanceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Template HSM dentro da própria conversa — o único envio que a linha oficial
 * aceita com a janela de 24h fechada. Antes só existia pela "Nova conversa",
 * que ninguém procura no meio de um atendimento.
 */
export function SendTemplateDialog({ conversationId, instanceId, open, onOpenChange }: Props) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [variables, setVariables] = useState<CampaignHsmVariable[]>([]);
  const send = useSendConversationTemplate(conversationId);

  const templatesQuery = useTemplates(open ? instanceId : null);
  const approved = (templatesQuery.data?.items ?? []).filter((t) => t.status === 'APPROVED');
  const selected = approved.find((t) => t.id === templateId) ?? null;
  const bodyText = (selected?.components.find((c) => c.type === 'BODY') as HsmBody | undefined)?.text;

  // Toda variável nasce "valor fixo" vazio: sem isso uma variável que o
  // atendente não tocou sairia sem valor e a Meta recusaria o template.
  useEffect(() => {
    setVariables(
      selected ? detectIndices(selected).map((index) => ({ index, source: 'static', value: '' })) : [],
    );
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) setTemplateId(null);
  }, [open]);

  async function submit() {
    if (!selected) return;
    if (variables.some((v) => v.source === 'static' && !v.value.trim())) {
      toast.error('Preencha todos os valores fixos das variáveis do template.');
      return;
    }
    try {
      await send.mutateAsync({ hsmTemplateId: selected.id, hsmVariables: variables });
      toast.success('Template enviado. O chat libera quando o cliente responder.');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar o template.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar template</DialogTitle>
          <DialogDescription>
            O template chega mesmo com a janela fechada, mas não reabre a conversa sozinho:
            ela volta a aceitar texto quando o cliente responder.
          </DialogDescription>
        </DialogHeader>

        {templatesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando templates…</p>
        ) : approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum template aprovado para este número. Crie e aprove um em
            Configurações → WhatsApp → Templates.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="st-template">Template</Label>
              <Select value={templateId ?? undefined} onValueChange={(v) => setTemplateId(v)}>
                <SelectTrigger id="st-template"><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                <SelectContent>
                  {approved.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {bodyText && (
              <p className="text-sm whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3">
                {bodyText}
              </p>
            )}
            {selected && (
              <HsmVariablesMapper template={selected} variables={variables} onChange={setVariables} />
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={!selected || send.isPending}>
            {send.isPending ? 'Enviando…' : 'Enviar template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
