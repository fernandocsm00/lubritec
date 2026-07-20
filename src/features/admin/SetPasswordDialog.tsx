import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { useSetPassword } from './api';
import { translateError } from './translateError';
import type { AdminUser } from '@shared/types';

const schema = z.object({
  password: z.string().min(8, 'Mínimo 8 caracteres'),
});

type FormData = z.infer<typeof schema>;

export function SetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setPassword = useSetPassword();
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: '' },
  });

  async function onSubmit(values: FormData) {
    try {
      await setPassword.mutateAsync({ id: user.id, password: values.password });
      toast.success(`Senha definida para ${user.email}. As sessões ativas foram encerradas.`);
      form.reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(translateError(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Definir senha — {user.name}</DialogTitle>
          <DialogDescription>
            {user.has_password
              ? 'A senha atual será substituída e todas as sessões ativas do usuário serão encerradas.'
              : 'O usuário passa a ter acesso liberado com esta senha — nenhum email é enviado.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova senha</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                      placeholder="Mínimo 8 caracteres"
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={setPassword.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={setPassword.isPending}>
                {setPassword.isPending ? 'Salvando…' : 'Definir senha'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
