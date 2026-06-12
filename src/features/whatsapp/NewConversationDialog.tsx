import { useEffect, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { useInstancesList } from '@/features/settings/whatsapp/api';
import { useTemplates } from '@/features/settings/whatsapp/templates/api';
import { HsmVariablesMapper } from '@/features/campaigns/HsmVariablesMapper';
import type { CampaignHsmVariable } from '@shared/types';
import { useStartConversation } from './api';
import type { MessageKind } from './types';

interface Props {
  onCreated?: (conversationId: string) => void;
}

type MediaKind = Exclude<MessageKind, 'text' | 'unknown' | 'audio'>;
const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Documento',
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export function NewConversationDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [includeMedia, setIncludeMedia] = useState(false);
  const [mediaKind, setMediaKind] = useState<MediaKind>('image');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaMime, setMediaMime] = useState('');
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [hsmTemplateId, setHsmTemplateId] = useState<string | null>(null);
  const [hsmVariables, setHsmVariables] = useState<CampaignHsmVariable[]>([]);

  const start = useStartConversation();

  const instancesQuery = useInstancesList();
  const instances = (instancesQuery.data?.items ?? []).filter((i) => !i.isArchived);
  const selectedInstance = instances.find((i) => i.id === instanceId) ?? null;
  const isMeta = selectedInstance?.provider === 'meta_cloud';

  // Seleciona a instância default (ou a primeira) quando a lista carrega.
  useEffect(() => {
    if (instanceId || instances.length === 0) return;
    const def = instances.find((i) => i.isDefault) ?? instances[0];
    setInstanceId(def.id);
  }, [instanceId, instances]);

  // Templates HSM só pra instância meta_cloud. Reseta seleção ao trocar de número.
  const templatesQuery = useTemplates(isMeta ? instanceId : null);
  const approvedTemplates = (templatesQuery.data?.items ?? []).filter((t) => t.status === 'APPROVED');
  const selectedTemplate = approvedTemplates.find((t) => t.id === hsmTemplateId) ?? null;

  useEffect(() => {
    // Troca de instância invalida template/variáveis (são por instância).
    setHsmTemplateId(null);
    setHsmVariables([]);
  }, [instanceId]);

  useEffect(() => {
    // Troca de template zera o mapeamento de variáveis.
    setHsmVariables([]);
  }, [hsmTemplateId]);

  function reset() {
    setPhone('');
    setName('');
    setText('');
    setIncludeMedia(false);
    setMediaKind('image');
    setMediaUrl('');
    setMediaMime('');
    setInstanceId(null);
    setHsmTemplateId(null);
    setHsmVariables([]);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit() {
    const phoneDigits = digitsOnly(phone);
    if (phoneDigits.length < 10) {
      toast.error('Telefone inválido. Use DDI+DDD+número (ex: 5511987654321).');
      return;
    }
    if (!instanceId) {
      toast.error('Selecione o número de envio.');
      return;
    }

    // Número oficial (Meta Cloud): só dispara via template HSM aprovado.
    if (isMeta) {
      if (!selectedTemplate) {
        toast.error('Selecione um template aprovado.');
        return;
      }
      // Variáveis "valor fixo" não podem ficar vazias (a Meta rejeita).
      const emptyStatic = hsmVariables.some((v) => v.source === 'static' && !v.value.trim());
      if (emptyStatic) {
        toast.error('Preencha todos os valores fixos das variáveis do template.');
        return;
      }
      try {
        const res = await start.mutateAsync({
          phone: phoneDigits,
          name: name.trim() || undefined,
          kind: 'text',
          instanceId,
          hsmTemplateId: selectedTemplate.id,
          hsmVariables,
        });
        toast.success('Conversa iniciada.');
        const convId = res.conversation.id;
        close();
        onCreated?.(convId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao iniciar conversa.');
      }
      return;
    }

    // Número não oficial (UazAPI): texto livre / mídia.
    if (includeMedia && !mediaUrl.trim()) {
      toast.error('Informe a URL da mídia.');
      return;
    }
    if (!includeMedia && !text.trim()) {
      toast.error('Digite uma mensagem ou anexe uma mídia.');
      return;
    }

    const payload = includeMedia
      ? {
          phone: phoneDigits,
          name: name.trim() || undefined,
          kind: mediaKind as MessageKind,
          mediaUrl: mediaUrl.trim(),
          mediaMime: mediaMime.trim() || undefined,
          body: text.trim() || undefined,
          instanceId,
        }
      : {
          phone: phoneDigits,
          name: name.trim() || undefined,
          kind: 'text' as MessageKind,
          body: text.trim(),
          instanceId,
        };

    try {
      const res = await start.mutateAsync(payload);
      toast.success('Conversa iniciada.');
      const convId = res.conversation.id;
      close();
      onCreated?.(convId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao iniciar conversa.';
      toast.error(msg);
    }
  }

  const submitDisabled =
    start.isPending || (isMeta && (!selectedTemplate || approvedTemplates.length === 0));

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <MessageSquarePlus className="h-4 w-4" />
        Nova conversa
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova conversa</DialogTitle>
            <DialogDescription>
              Inicie uma conversa enviando a primeira mensagem para um número de WhatsApp.
              Se já existir conversa com esse número, ela será reutilizada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Seletor de número — só aparece quando há mais de uma instância. */}
            {instances.length > 1 && (
              <div>
                <Label htmlFor="nc-instance">Enviar do número</Label>
                <Select value={instanceId ?? undefined} onValueChange={(v) => setInstanceId(v)}>
                  <SelectTrigger id="nc-instance"><SelectValue placeholder="Selecione o número" /></SelectTrigger>
                  <SelectContent>
                    {instances.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.displayName}
                        {i.provider === 'meta_cloud' ? ' · oficial' : ' · não oficial'}
                        {i.isDefault ? ' · padrão' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="nc-phone">Telefone (com DDI e DDD)</Label>
              <Input
                id="nc-phone"
                placeholder="55 11 98765-4321"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Apenas dígitos são enviados. Ex.: 5511987654321.
              </p>
            </div>

            <div>
              <Label htmlFor="nc-name">Nome do contato (opcional)</Label>
              <Input
                id="nc-name"
                placeholder="João Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Se vazio e o lead ainda não existir, usaremos o telefone como nome.
              </p>
            </div>

            {/* Número oficial: seleção de template HSM + variáveis. */}
            {isMeta ? (
              <div className="space-y-3 rounded-md border border-border p-3 bg-muted/30">
                <p className="text-[11px] text-muted-foreground">
                  Número oficial (Meta Cloud) só inicia conversa via <strong>template aprovado</strong>.
                </p>
                {templatesQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando templates…</p>
                ) : approvedTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum template aprovado para este número. Crie e aprove um template em
                    Configurações → WhatsApp → Templates antes de iniciar a conversa.
                  </p>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="nc-template">Template</Label>
                      <Select value={hsmTemplateId ?? undefined} onValueChange={(v) => setHsmTemplateId(v)}>
                        <SelectTrigger id="nc-template"><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                        <SelectContent>
                          {approvedTemplates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name} · {t.language}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedTemplate && (
                      <HsmVariablesMapper
                        template={selectedTemplate}
                        variables={hsmVariables}
                        onChange={setHsmVariables}
                      />
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="nc-text">
                    Mensagem {includeMedia && <span className="text-muted-foreground font-normal">(legenda da mídia, opcional)</span>}
                  </Label>
                  <Textarea
                    id="nc-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={includeMedia ? 'Legenda opcional da mídia' : 'Digite a primeira mensagem'}
                    rows={3}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="nc-media-toggle"
                    type="checkbox"
                    checked={includeMedia}
                    onChange={(e) => setIncludeMedia(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="nc-media-toggle" className="cursor-pointer font-normal">
                    Anexar mídia (imagem, vídeo ou documento)
                  </Label>
                </div>

                {includeMedia && (
                  <div className="space-y-3 rounded-md border border-border p-3 bg-muted/30">
                    <div>
                      <Label>Tipo de mídia</Label>
                      <Select value={mediaKind} onValueChange={(v) => setMediaKind(v as MediaKind)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(MEDIA_KIND_LABEL) as MediaKind[]).map((k) => (
                            <SelectItem key={k} value={k}>{MEDIA_KIND_LABEL[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="nc-media-url">URL pública da mídia</Label>
                      <Input
                        id="nc-media-url"
                        placeholder="https://…"
                        value={mediaUrl}
                        onChange={(e) => setMediaUrl(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="nc-media-mime">MIME type (opcional)</Label>
                      <Input
                        id="nc-media-mime"
                        placeholder="image/jpeg, video/mp4, application/pdf…"
                        value={mediaMime}
                        onChange={(e) => setMediaMime(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={start.isPending}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={submitDisabled}>
              {start.isPending ? 'Enviando…' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
