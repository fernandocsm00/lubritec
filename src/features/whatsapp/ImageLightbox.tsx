import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * Miniatura clicavel que abre a imagem em tamanho grande.
 *
 * Por que object-contain e nao object-cover: a bolha do chat tem no maximo 65%
 * da largura e teto de 256px de altura. Com object-cover, um print de orcamento
 * (ex.: 1200x538) chegava RECORTADO — nao dava nem pra saber o que tinha nele.
 * Com contain a imagem inteira aparece, so que reduzida; o clique resolve o
 * resto.
 */
export function ImageLightbox({ src, alt = 'imagem' }: { src: string; alt?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        title="Clique para ampliar"
        className="rounded mb-1 max-w-full max-h-64 object-contain cursor-zoom-in"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        {/* max-w-lg do DialogContent e pequeno demais pra visualizar imagem. */}
        <DialogContent className="max-w-[92vw] w-auto p-3 gap-2">
          {/* O Radix exige titulo pra leitor de tela; aqui ele nao deve aparecer. */}
          <DialogTitle className="sr-only">Imagem ampliada</DialogTitle>

          <img
            src={src}
            alt={alt}
            className="max-h-[85vh] max-w-full w-auto mx-auto object-contain rounded"
          />

          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Abrir original
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
