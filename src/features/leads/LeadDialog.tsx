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
import { LEAD_STATUSES, type PublicLead } from '@shared/types';

const cnpjDigits = (s: string) => s.replace(/\D/g, '');

const baseSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').max(120),
  // Phone agora opcional — leads CNPJ-only viram 'incomplete' até enriquecimento.
  // Quando preenchido, valida 8+ dígitos.
  phone: z
    .string()
    .refine((v) => v === '' || v.replace(/\D/g, '').length >= 8, 'Telefone muito curto')
    .optional()
    .or(z.literal('')),
  cnpj: z
    .string()
    .refine((v) => cnpjDigits(v).length === 14, 'CNPJ deve ter 14 dígitos'),
  email: z.string().email('Email inválido').or(z.literal('')).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
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
  // Lead criado via WhatsApp inbound vem sem CNPJ. Liberamos a edição nesses
  // casos. Uma vez setado, vira imutável (regra do backend).
  const cnpjEditable = !isEdit || !lead?.cnpj;
  // Lead CNPJ-only do CSV vem sem phone. Mesmo padrão do CNPJ.
  const phoneEditable = !isEdit || !lead?.phone;

  const form = useForm<FormData>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      name: '',
      phone: '',
      cnpj: '',
      email: '',
      notes: '',
      status: 'frio',
    },
  });

  useEffect(() => {
    if (open) {
      if (lead) {
        form.reset({
          name: lead.name,
          phone: lead.phone ?? '',
          cnpj: lead.cnpj ?? '',
          email: lead.email ?? '',
          notes: lead.notes ?? '',
          status: lead.status,
        });
      } else {
        form.reset({
          name: '',
          phone: '',
          cnpj: '',
          email: '',
          notes: '',
          status: 'frio',
        });
      }
    }
  }, [open, lead, form]);

  async function onSubmit(values: FormData) {
    const payload = {
      name: values.name,
      email: nullify(values.email),
      notes: nullify(values.notes),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar lead' : 'Novo lead'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome *</FormLabel>
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
                    <FormLabel>Telefone {!isEdit && '*'}</FormLabel>
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
      </DialogContent>
    </Dialog>
  );
}
