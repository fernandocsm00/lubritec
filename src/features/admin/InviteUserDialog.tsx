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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInviteUser } from './api';
import { translateError } from './translateError';
import { ROLES } from '@shared/types';

const schema = z
  .object({
    name: z.string().min(2, 'Nome muito curto'),
    email: z.string().email('Email inválido'),
    role: z.enum(ROLES),
    // 'invite' = envia email com link de cadastro (usuário define a própria senha).
    // 'password' = admin define a senha agora; nasce ativo, sem email.
    mode: z.enum(['invite', 'password']),
    password: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'password' && (!data.password || data.password.length < 8)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'Mínimo 8 caracteres',
      });
    }
  });

type FormData = z.infer<typeof schema>;

export function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invite = useInviteUser();
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', role: 'comercial', mode: 'invite', password: '' },
  });

  const mode = form.watch('mode');

  async function onSubmit(values: FormData) {
    try {
      await invite.mutateAsync({
        name: values.name,
        email: values.email,
        role: values.role,
        password: values.mode === 'password' ? values.password : undefined,
      });
      toast.success(
        values.mode === 'password'
          ? `Usuário ${values.email} criado com acesso liberado`
          : `Convite enviado para ${values.email}`,
      );
      form.reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(translateError(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>
            {mode === 'password'
              ? 'O usuário será criado já ativo com a senha definida — nenhum email é enviado.'
              : 'Um email com o link de cadastro será enviado.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="name" />
                  </FormControl>
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
                  <FormControl>
                    <Input {...field} type="email" autoComplete="email" />
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
                  <Select onValueChange={field.onChange} value={field.value}>
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
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Como liberar o acesso</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={field.value === 'invite' ? 'default' : 'outline'}
                      onClick={() => field.onChange('invite')}
                    >
                      Convite por email
                    </Button>
                    <Button
                      type="button"
                      variant={field.value === 'password' ? 'default' : 'outline'}
                      onClick={() => field.onChange('password')}
                    >
                      Definir senha agora
                    </Button>
                  </div>
                </FormItem>
              )}
            />

            {mode === 'password' && (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="new-password"
                        placeholder="Mínimo 8 caracteres"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={invite.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending
                  ? 'Salvando…'
                  : mode === 'password'
                    ? 'Criar usuário'
                    : 'Enviar convite'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
