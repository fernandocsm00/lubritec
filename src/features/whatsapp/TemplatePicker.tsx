import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';
import { useTemplates } from './api';

interface Props { onPick: (body: string) => void }

export function TemplatePicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const { data } = useTemplates();
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        title="Templates"
      >
        <Zap className="h-5 w-5" />
      </Button>
      {open && (
        <div
          className="absolute bottom-12 left-0 w-72 bg-popover border border-border rounded-md shadow-lg p-2 z-10 max-h-72 overflow-y-auto"
          onMouseLeave={() => setOpen(false)}
        >
          {!data?.items.length && (
            <p className="text-xs text-muted-foreground p-3">Nenhum template salvo.</p>
          )}
          {data?.items.map((t) => (
            <button
              key={t.id}
              className="w-full text-left p-2 hover:bg-muted rounded"
              onClick={() => { onPick(t.body); setOpen(false); }}
            >
              <div className="text-sm font-medium">{t.title}</div>
              <div className="text-xs text-muted-foreground line-clamp-2">{t.body}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
