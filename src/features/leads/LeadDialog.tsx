import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateLead, useUpdateLead } from './api';
import { translateError } from './translateError';
import { StageTimeline } from './StageTimeline';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CaseSheet } from '@/features/case-sheet/CaseSheet';
import { useAuthStore } from '@/features/auth/store';
import {
  LEAD_STATUSES,
  IMBP_VALUES,
  IMBP_LABELS,
  SEGMENT_VALUES,
  SEGMENT_LABELS,
  IMBP_TO_SEGMENT,
  type PublicLead,
} from '@shared/types';

const cnpjDigits = (s: string) => s.replace(/\D/g, '');

const phoneOptional = z
  .string()
  .refine((v) => v === '' || v.replace(/\D/g, '').length >= 8, 'Telefone muito curto')
  .optional()
  .or(z.literal(''));

const baseSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').max(120),
  // Phone agora opcional — leads CNPJ-only viram 'incomplete' até enriquecimento.
  // Quando preenchido, valida 8+ dígitos.
  phone: phoneOptional,
  phone2: phoneOptional,
  cnpj: z
    .string()
    .refine((v) => cnpjDigits(v).length === 14, 'CNPJ deve ter 14 dígitos'),
  email: z.string().email('Email inválido').or(z.literal('')).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  address1: z.string().max(255).optional().or(z.literal('')),
  address2: z.string().max(255).optional().or(z.literal('')),
  city: z.string().max(120).optional().or(z.literal('')),
  imbp: z.enum(IMBP_VALUES).optional().or(z.literal('')),
  segment: z.enum(SEGMENT_VALUES).optional().or(z.literal('')),
});

type FormData = z.infer<typeof baseSchema>;

function nullify<T extends string | undefined>(v: T): string | null {
  return v == null || v === '' ? null : v;
}

export function LeadDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: PublicLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateLead();
  const update = useUpdateLead();
  const isEdit = lead !== null;
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'admin';
  // Lead criado via WhatsApp inbound vem sem CNPJ. Liberamos a edição nesses
  // casos. Uma vez setado, vira imutável (regra do backend).
  const cnpjEditable = !isEdit || !lead?.cnpj;
  // Lead CNPJ-only do CSV vem sem phone. Mesmo padrão do CNPJ.
  const phoneEditable = !isEdit || !lead?.phone;

  const emptyDefaults: FormData = {
    name: '',
    phone: '',
    phone2: '',
    cnpj: '',
    email: '',
    notes: '',
    status: 'frio',
    address1: '',
    address2: '',
    city: '',
    imbp: '',
    segment: '',
  };

  const form = useForm<FormData>({
    resolver: zodResolver(baseSchema),
    defaultValues: emptyDefaults,
  });

  // Quando IMBP muda, preenche Segmento automaticamente conforme a taxonomia.
  // Mantemos os dois campos editaveis pra UX (usuario ve o segmento derivado),
  // mas o backend re-deriva por seguranca.
  const watchedImbp = form.watch('imbp');
  useEffect(() => {
    if (watchedImbp && IMBP_VALUES.includes(watchedImbp as typeof IMBP_VALUES[number])) {
      const seg = IMBP_TO_SEGMENT[watchedImbp as typeof IMBP_VALUES[number]];
      form.setValue('segment', seg, { shouldDirty: false });
    }
  }, [watchedImbp, form]);

  useEffect(() => {
    if (open) {
      if (lead) {
        form.reset({
          name: lead.name,
          phone: lead.phone ?? '',
          phone2: lead.phone2 ?? '',
          cnpj: lead.cnpj ?? '',
          email: lead.email ?? '',
          notes: lead.notes ?? '',
          status: lead.status,
          address1: lead.address1 ?? '',
          address2: lead.address2 ?? '',
          city: lead.city ?? '',
          imbp: lead.imbp ?? '',
          segment: lead.segment ?? '',
        });
      } else {
        form.reset(emptyDefaults);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead, form]);

  async function onSubmit(values: FormData) {
    const extendedPayload = {
      address1: nullify(values.address1),
      address2: nullify(values.address2),
      city: nullify(values.city),
      imbp: values.imbp ? values.imbp : null,
      segment: values.segment ? values.segment : null,
      phone2: nullify((values.phone2 ?? '').replace(/\D/g, '')),
    };
    const payload = {
      name: values.name,
      email: nullify(values.email),
      notes: nullify(values.notes),
      ...extendedPayload,
    };
    try {
      if (isEdit && lead) {
        const phoneTrim = (values.phone ?? '').trim();
        await update.mutateAsync({
          id: lead.id,
          ...payload,
          status: values.status,
          // Só envia CNPJ no update se for editável (lead sem CNPJ atual).
          ...(cnpjEditable ? { cnpj: cnpjDigits(values.cnpj) } : {}),
          // Mesmo padrão pra phone — só envia se editável e preenchido.
          ...(phoneEditable && phoneTrim ? { phone: phoneTrim } : {}),
        });
        toast.success('Lead atualizado.');
      } else {
        const phoneTrim = (values.phone ?? '').trim();
        await create.mutateAsync({
          phone: phoneTrim || undefined,
          cnpj: cnpjDigits(values.cnpj),
          ...payload,
        });
        toast.success('Lead criado.');
      }
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao salvar.';
      toast.error(msg);
    }
  }

  const pending = create.isPending || update.isPending;

  // Bloco reutilizado pelos dois formularios (criar / editar). Contem todos os
  // campos adicionais da taxonomia comercial Lubritec.
  const extendedFieldsBlock = (
    <div className="border-t pt-4 space-y-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Dados complementares
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="phone2"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Telefone 2</FormLabel>
              <FormControl><Input {...field} placeholder="55 11 98765-4321" /></FormControl>
              <p className="text-xs text-muted-foreground">Usado como fallback se o Telefone 1 falhar no disparo.</p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cidade</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address1"
          render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Endereço 1</FormLabel>
              <FormControl><Input {...field} placeholder="Rua, número, bairro" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address2"
          render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Endereço 2 (complemento)</FormLabel>
              <FormControl><Input {...field} placeholder="Sala, andar, ponto de referência" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="imbp"
          render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>IMBP — Linha de Negócio</FormLabel>
              <Select onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)} value={field.value || '__none__'}>
                <FormControl><SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="__none__">— não definido —</SelectItem>
                  {IMBP_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>{IMBP_LABELS[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="segment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Segmento</FormLabel>
              <Select onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)} value={field.value || '__none__'}>
                <FormControl><SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="__none__">— não definido —</SelectItem>
                  {SEGMENT_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>{SEGMENT_LABELS[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Preenchido automaticamente quando IMBP é definido.</p>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar lead' : 'Novo lead'}</DialogTitle>
        </DialogHeader>
        {isEdit ? (
          <Tabs defaultValue="info">
            <TabsList>
              <TabsTrigger value="info">Informações</TabsTrigger>
              <TabsTrigger value="case-sheet">Ficha do Caso</TabsTrigger>
            </TabsList>
            <TabsContent value="info">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome da Conta *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cnpj"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CNPJ *</FormLabel>
                    <FormControl><Input {...field} disabled={!cnpjEditable} placeholder="00.000.000/0000-00" /></FormControl>
                    {!cnpjEditable && (
                      <p className="text-xs text-muted-foreground">
                        CNPJ não pode ser alterado depois de salvo.
                      </p>
                    )}
                    {isEdit && cnpjEditable && (
                      <p className="text-xs text-muted-foreground">
                        Lead criado via WhatsApp — informe o CNPJ para concluir o cadastro.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone 1 {!isEdit && '*'}</FormLabel>
                    <FormControl><Input {...field} disabled={!phoneEditable} placeholder="55 11 98765-4321" /></FormControl>
                    {!phoneEditable && (
                      <p className="text-xs text-muted-foreground">
                        Telefone não pode ser alterado depois de salvo.
                      </p>
                    )}
                    {isEdit && phoneEditable && (
                      <p className="text-xs text-muted-foreground">
                        Lead sem telefone — informe manualmente ou aguarde enriquecimento automático.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input {...field} type="email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isEdit && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="frio">Frio</SelectItem>
                          <SelectItem value="morno">Morno</SelectItem>
                          <SelectItem value="quente">Quente</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl><Textarea {...field} rows={3} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {extendedFieldsBlock}
            {isEdit && lead && (
              <details className="border-t pt-3 -mx-1 px-1">
                <summary className="text-xs font-medium cursor-pointer text-muted-foreground hover:text-foreground">
                  Histórico de etapas do funil
                </summary>
                <div className="mt-3">
                  <StageTimeline leadId={lead.id} />
                </div>
              </details>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
            </TabsContent>
            <TabsContent value="case-sheet">
              {lead?.id && (
                <div className="max-h-[60vh] overflow-y-auto pr-1">
                  <CaseSheet leadId={lead.id} isAdmin={isAdmin} />
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome da Conta *</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cnpj"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CNPJ *</FormLabel>
                      <FormControl><Input {...field} placeholder="00.000.000/0000-00" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefone 1 *</FormLabel>
                      <FormControl><Input {...field} placeholder="55 11 98765-4321" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input {...field} type="email" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observações</FormLabel>
                    <FormControl><Textarea {...field} rows={3} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {extendedFieldsBlock}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Salvando…' : 'Criar'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
