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
import { LEAD_STATUSES, type PublicLead } from '@shared/types';

const baseSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').max(120),
  phone: z.string().min(8, 'Telefone muito curto'),
  email: z.string().email('Email inválido').or(z.literal('')).optional(),
  vehiclePlate: z.string().max(10).optional(),
  vehicleModel: z.string().max(60).optional(),
  lastPurchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').or(z.literal('')).optional(),
  avgMileagePerDay: z.string().regex(/^\d*$/, 'Apenas números').optional(),
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

  const form = useForm<FormData>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      vehiclePlate: '',
      vehicleModel: '',
      lastPurchaseDate: '',
      avgMileagePerDay: '',
      notes: '',
      status: 'frio',
    },
  });

  useEffect(() => {
    if (open) {
      if (lead) {
        form.reset({
          name: lead.name,
          phone: lead.phone,
          email: lead.email ?? '',
          vehiclePlate: lead.vehiclePlate ?? '',
          vehicleModel: lead.vehicleModel ?? '',
          lastPurchaseDate: lead.lastPurchaseDate ?? '',
          avgMileagePerDay: lead.avgMileagePerDay?.toString() ?? '',
          notes: lead.notes ?? '',
          status: lead.status,
        });
      } else {
        form.reset({
          name: '',
          phone: '',
          email: '',
          vehiclePlate: '',
          vehicleModel: '',
          lastPurchaseDate: '',
          avgMileagePerDay: '',
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
      vehiclePlate: nullify(values.vehiclePlate),
      vehicleModel: nullify(values.vehicleModel),
      lastPurchaseDate: nullify(values.lastPurchaseDate),
      avgMileagePerDay: values.avgMileagePerDay ? Number(values.avgMileagePerDay) : null,
      notes: nullify(values.notes),
    };
    try {
      if (isEdit && lead) {
        await update.mutateAsync({ id: lead.id, ...payload, status: values.status });
        toast.success('Lead atualizado.');
      } else {
        await create.mutateAsync({ phone: values.phone, ...payload });
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
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone *</FormLabel>
                    <FormControl><Input {...field} disabled={isEdit} /></FormControl>
                    {isEdit && (
                      <p className="text-xs text-muted-foreground">
                        Telefone não pode ser alterado. Para mudar, exclua e cadastre novamente.
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
              <FormField
                control={form.control}
                name="vehiclePlate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Placa</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vehicleModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastPurchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Última compra</FormLabel>
                    <FormControl><Input {...field} type="date" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="avgMileagePerDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Km/dia (média)</FormLabel>
                    <FormControl><Input {...field} inputMode="numeric" /></FormControl>
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
