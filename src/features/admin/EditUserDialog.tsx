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
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateUser } from './api';
import { translateError } from './translateError';
import { ROLES, type AdminUser } from '@shared/types';

const schema = z.object({
  name: z.string().min(2, 'Nome muito curto'),
  role: z.enum(ROLES),
  phone: z.string().max(40).optional(),
});

type FormData = z.infer<typeof schema>;

export function EditUserDialog({
  user,
  isSelf,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  isSelf: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateUser();
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: user.name, role: user.role, phone: user.phone ?? '' },
  });

  useEffect(() => {
    if (open) form.reset({ name: user.name, role: user.role, phone: user.phone ?? '' });
  }, [open, user.name, user.role, user.phone, form]);

  async function onSubmit(values: FormData) {
    const diff: { name?: string; role?: typeof user.role; phone?: string | null } = {};
    if (values.name !== user.name) diff.name = values.name;
    if (!isSelf && values.role !== user.role) diff.role = values.role;
    const newPhone = (values.phone ?? '').trim();
    const currentPhone = user.phone ?? '';
    if (newPhone !== currentPhone) {
      diff.phone = newPhone === '' ? null : newPhone;
    }
    if (Object.keys(diff).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync({ id: user.id, ...diff });
      toast.success('Usuário atualizado.');
      onOpenChange(false);
    } catch (e) {
      toast.error(translateError(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Email eh display-only, nao eh um campo controlado pelo react-hook-form.
                NAO usar FormItem/FormLabel aqui — eles dependem do contexto criado
                por <FormField> e quebram com "useFormField should be used within <FormField>". */}
            <div className="space-y-2">
              <label
                htmlFor="edit-user-email"
                className="text-sm font-medium leading-none"
              >
                Email
              </label>
              <Input id="edit-user-email" value={user.email} disabled />
              <p className="text-xs text-muted-foreground">Email não pode ser alterado.</p>
            </div>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>WhatsApp pessoal</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex: 5554999998888 (com DDI+DDD, só dígitos)"
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Usado pra receber notificação de leads qualificados pela IA.
                    Deixe em branco pra desativar.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isSelf}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="comercial">Comercial</SelectItem>
                      <SelectItem value="recepcao">Recepção</SelectItem>
                    </SelectContent>
                  </Select>
                  {isSelf && (
                    <p className="text-xs text-muted-foreground">
                      Você não pode alterar sua própria role.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={update.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
