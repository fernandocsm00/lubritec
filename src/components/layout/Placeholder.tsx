import { Construction } from 'lucide-react';

export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-6">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
        style={{
          background: 'linear-gradient(135deg, var(--lc-navy), var(--lc-navy-soft))',
          boxShadow: '0 12px 28px -12px rgba(11,37,69,0.4)',
        }}
      >
        <Construction className="h-6 w-6 text-white" />
      </div>
      <div
        className="font-mono text-[10px] uppercase mb-2 text-muted-foreground"
        style={{ letterSpacing: '0.18em' }}
      >
        Em desenvolvimento
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-lc-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">{description}</p>
    </div>
  );
}
