import { useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useUploadMedia } from './api';

interface Props {
  mediaUrl: string | null;
  onChange: (mediaUrl: string | null, mediaMime: string | null) => void;
}

export function MediaUpload({ mediaUrl, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadMedia();

  async function handleFile(file: File) {
    try {
      const r = await upload.mutateAsync(file);
      onChange(r.mediaUrl, r.mediaMime);
      toast.success('Imagem carregada.');
    } catch {
      toast.error('Falha ao carregar imagem.');
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {mediaUrl ? (
        <div className="relative inline-block">
          <img src={mediaUrl} alt="anexada" className="max-w-xs max-h-48 rounded border border-border" />
          <button
            type="button"
            className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center"
            onClick={() => onChange(null, null)}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          <Upload className="h-4 w-4 mr-2" /> {upload.isPending ? 'Enviando…' : 'Adicionar imagem'}
        </Button>
      )}
    </div>
  );
}
