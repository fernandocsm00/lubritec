import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin, useRequestReset } from '@/features/auth/api';
import { BrandLockup } from '@/components/brand/BrandMark';
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
    <div className="min-h-screen grid md:grid-cols-2 bg-white">
      {/* Left brand panel */}
      <div
        className="relative overflow-hidden p-10 md:p-14 hidden md:flex flex-col justify-between text-white"
        style={{
          background:
            'linear-gradient(140deg, var(--lc-navy-deep) 0%, var(--lc-navy) 60%, var(--lc-ink) 100%)',
        }}
      >
        <div className="lc-hex-pattern absolute inset-0 pointer-events-none" />
        <div
          className="absolute -top-32 -right-32 w-[420px] h-[420px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(232,163,23,0.15) 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-40 -left-24 w-[380px] h-[380px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(200,16,46,0.13) 0%, transparent 70%)' }}
        />

        <div className="relative">
          <BrandLockup size={32} dark />
        </div>

        <div className="relative max-w-[460px]">
          <div
            className="font-mono text-[11px] uppercase mb-4"
            style={{ color: 'var(--lc-amber-soft)', letterSpacing: '0.22em' }}
          >
            CRM da operação
          </div>
          <h1
            className="text-[42px] md:text-5xl font-bold tracking-tight leading-[1.05] m-0 mb-5"
          >
            Cada lead<br />qualificado.<br />
            <span style={{ color: 'var(--lc-amber-soft)' }}>Cada deal,</span><br />
            <span style={{ color: 'var(--lc-amber-soft)' }}>fechado.</span>
          </h1>
          <p className="text-[15px] leading-relaxed text-white/70 m-0 max-w-[420px]">
            Inbox WhatsApp, qualificação por IA e pipeline de vendas — uma plataforma só
            para o time da Lubritec rodar 100% da jornada do cliente.
          </p>

          <div className="flex gap-6 mt-9">
            {[
              { k: '12.4k', v: 'Leads ativos' },
              { k: '342',   v: 'Deals no pipeline' },
              { k: '94%',   v: 'Resp. < 5min' },
            ].map((s) => (
              <div key={s.v}>
                <div className="text-[26px] font-bold tracking-tight">{s.k}</div>
                <div className="text-[11px] text-white/55 uppercase mt-0.5" style={{ letterSpacing: '0.08em' }}>
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative font-mono text-[11px] text-white/40" style={{ letterSpacing: '0.06em' }}>
          v2.4 · Lubritec Brasil · São Paulo
        </div>
      </div>

      {/* Right form */}
      <div
        className="flex items-center justify-center p-6 md:p-10"
        style={{ background: 'var(--lc-paper)' }}
      >
        <div className="w-full max-w-[420px] bg-card border border-border rounded-2xl p-9 shadow-lc-card">
          <div
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-semibold mb-5"
            style={{ background: 'rgba(15,138,95,0.1)', color: 'hsl(var(--success))' }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'hsl(var(--success))' }} />
            Sistema operando · 0 incidentes
          </div>

          <h2 className="text-[26px] font-bold tracking-tight text-lc-ink m-0 mb-1.5">
            Conectando pessoas, acelerando negócios
          </h2>
          <p className="text-sm text-muted-foreground m-0 mb-6">
            Entre com seu e-mail corporativo @lubritec.com.br
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold">E-mail</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <Label htmlFor="password" className="text-xs font-semibold">Senha</Label>
                {!forgot && (
                  <button
                    type="button"
                    onClick={() => setForgot(true)}
                    className="text-xs font-medium text-lc-navy hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                )}
              </div>
              <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <Button
              type="submit"
              className="w-full gap-2 shadow-lc-cta"
              disabled={login.isPending}
            >
              {login.isPending ? 'Entrando…' : (
                <>Entrar no LubriConnect <ArrowRight className="h-4 w-4" /></>
              )}
            </Button>
          </form>

          {forgot && <ForgotForm onSubmit={onForgot} pending={requestReset.isPending} />}

          <div className="mt-6 pt-4 border-t border-dashed border-border flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Acesso protegido por SSO + MFA</span>
            <span className="font-mono">SOC2 · LGPD</span>
          </div>
        </div>
      </div>
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
