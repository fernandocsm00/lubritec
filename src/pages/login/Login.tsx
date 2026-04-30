import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useLogin, useRequestReset } from '@/features/auth/api';
import { toast } from 'sonner';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});
type FormData = z.infer<typeof schema>;

export default function Login() {
  const navigate = useNavigate();
  const login = useLogin();
  const requestReset = useRequestReset();
  const [forgot, setForgot] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await login.mutateAsync(data);
      navigate('/dashboard');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro';
      toast.error(msg === 'Invalid credentials' ? 'Credenciais inválidas' : msg);
    }
  };

  const onForgot = async (email: string) => {
    if (!email || !z.string().email().safeParse(email).success) {
      toast.error('Informe um e-mail válido');
      return;
    }
    await requestReset.mutateAsync(email);
    toast.success('Se o e-mail existir, enviamos um link de redefinição.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-primary">LubriConnect</h1>
          <p className="text-sm text-muted-foreground">Entre com seu e-mail e senha.</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        {!forgot ? (
          <button
            onClick={() => setForgot(true)}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Esqueci minha senha
          </button>
        ) : (
          <ForgotForm onSubmit={onForgot} pending={requestReset.isPending} />
        )}
      </Card>
    </div>
  );
}

function ForgotForm({ onSubmit, pending }: { onSubmit: (email: string) => void; pending: boolean }) {
  const [email, setEmail] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(email); }}
      className="mt-4 space-y-2 border-t pt-4"
    >
      <Label htmlFor="forgot-email" className="text-xs">Digite seu e-mail</Label>
      <Input
        id="forgot-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" variant="outline" className="w-full" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviar link de redefinição'}
      </Button>
    </form>
  );
}
