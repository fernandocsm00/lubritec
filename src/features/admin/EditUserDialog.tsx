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
    defaultValues: { name: user.name, role: user.role },
  });

  useEffect(() => {
    if (open) form.reset({ name: user.name, role: user.role });
  }, [open, user.name, user.role, form]);

  async function onSubmit(values: FormData) {
    const diff: { name?: string; role?: typeof user.role } = {};
    if (values.name !== user.name) diff.name = values.name;
    if (!isSelf && values.role !== user.role) diff.role = values.role;
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
            <FormItem>
              <FormLabel>Email</FormLabel>
              <Input value={user.email} disabled />
              <p className="text-xs text-muted-foreground">Email não pode ser alterado.</p>
            </FormItem>
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
