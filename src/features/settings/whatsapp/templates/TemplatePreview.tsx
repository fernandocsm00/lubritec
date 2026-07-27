import type { HsmComponent } from './types';

interface Props {
  components: HsmComponent[];
  /** URL da imagem de header já enviada — mostra a imagem real no preview. */
  headerMediaUrl?: string | null;
}

function findComponent<T extends HsmComponent['type']>(
  components: HsmComponent[], type: T,
): Extract<HsmComponent, { type: T }> | undefined {
  return components.find((c) => c.type === type) as never;
}

function renderBodyWithHighlight(text: string) {
  // Highlight {{N}} in a distinguishable color
  const parts = text.split(/(\{\{\d+\}\})/g);
  return parts.map((p, i) =>
    /^\{\{\d+\}\}$/.test(p)
      ? <span key={i} className="bg-amber-200 text-amber-900 px-1 rounded">{p}</span>
      : <span key={i}>{p}</span>
  );
}

export function TemplatePreview({ components, headerMediaUrl }: Props) {
  const header = findComponent(components, 'HEADER');
  const body = findComponent(components, 'BODY');
  const footer = findComponent(components, 'FOOTER');
  const buttons = findComponent(components, 'BUTTONS');

  return (
    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
      <div className="bg-white rounded-lg shadow-sm p-3 max-w-xs space-y-2">
        {header && 'format' in header && header.format === 'TEXT' && 'text' in header && (
          <div className="font-semibold text-sm">{header.text}</div>
        )}
        {header && 'format' in header && header.format === 'IMAGE' && headerMediaUrl && (
          <img src={headerMediaUrl} alt="Header" className="rounded w-full h-32 object-cover" />
        )}
        {header && 'format' in header && header.format !== 'TEXT'
          && !(header.format === 'IMAGE' && headerMediaUrl) && (
          <div className="bg-zinc-100 rounded h-32 flex items-center justify-center text-xs text-zinc-500">
            [{header.format}]
          </div>
        )}
        {body && (
          <div className="text-sm whitespace-pre-wrap break-words">
            {renderBodyWithHighlight(body.text)}
          </div>
        )}
        {footer && (
          <div className="text-xs text-zinc-500 italic">{footer.text}</div>
        )}
        {buttons && buttons.buttons.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-zinc-100">
            {buttons.buttons.map((b, i) => (
              <button key={i} className="block w-full text-center text-sm py-1.5 text-lc-navy hover:bg-zinc-50 rounded">
                {b.text}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
