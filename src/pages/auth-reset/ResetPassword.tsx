import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useResetPassword } from '@/features/auth/api';
import { toast } from 'sonner';

const schema = z
  .object({
    password: z.string().min(8, 'Senha precisa ter pelo menos 8 caracteres'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Senhas não conferem' });
type FormData = z.infer<typeof schema>;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const id = params.get('id') || '';
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const mutation = useResetPassword();

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await mutation.mutateAsync({ tokenId: id, rawToken: token, password: data.password });
      toast.success('Senha redefinida.');
      navigate('/dashboard');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  };

  if (!id || !token) return <div className="p-6">Link inválido.</div>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold text-primary">Redefinir senha</h1>
        <p className="mb-4 text-sm text-muted-foreground">Escolha uma nova senha de acesso.</p>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input id="password" type="password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmar senha</Label>
            <Input id="confirm" type="password" {...register('confirm')} />
            {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Redefinir'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
