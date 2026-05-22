import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import type { HsmComponent, HsmHeader, HsmBody, HsmFooter, HsmButtons, HsmButton } from './types';

interface Props {
  components: HsmComponent[];
  onChange: (next: HsmComponent[]) => void;
}

function setComponent(components: HsmComponent[], next: HsmComponent | null, type: HsmComponent['type']): HsmComponent[] {
  const filtered = components.filter((c) => c.type !== type);
  if (next === null) return filtered;
  // Preserve order: HEADER, BODY, FOOTER, BUTTONS
  const order: HsmComponent['type'][] = ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'];
  const combined = [...filtered, next];
  combined.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return combined;
}

export function TemplateComponentsEditor({ components, onChange }: Props) {
  const header = components.find((c) => c.type === 'HEADER') as HsmHeader | undefined;
  const body = components.find((c) => c.type === 'BODY') as HsmBody | undefined;
  const footer = components.find((c) => c.type === 'FOOTER') as HsmFooter | undefined;
  const buttons = components.find((c) => c.type === 'BUTTONS') as HsmButtons | undefined;

  // Detect {{N}} in body
  const detectedVars = useMemo(() => {
    if (!body) return [];
    const matches = body.text.match(/\{\{(\d+)\}\}/g) ?? [];
    return Array.from(new Set(matches)).map((m) => parseInt(m.slice(2, -2), 10)).sort((a, b) => a - b);
  }, [body]);

  // ─── HEADER ───
  const setHeaderType = (type: 'none' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT') => {
    if (type === 'none') {
      onChange(setComponent(components, null, 'HEADER'));
    } else if (type === 'TEXT') {
      onChange(setComponent(components, { type: 'HEADER', format: 'TEXT', text: '' }, 'HEADER'));
    } else {
      onChange(setComponent(components, { type: 'HEADER', format: type }, 'HEADER'));
    }
  };

  const setHeaderText = (text: string) => {
    onChange(setComponent(components, { type: 'HEADER', format: 'TEXT', text }, 'HEADER'));
  };

  // ─── BODY ───
  const setBodyText = (text: string) => {
    onChange(setComponent(components, { type: 'BODY', text }, 'BODY'));
  };

  const setBodyExample = (varIdx: number, value: string) => {
    if (!body) return;
    const currentExamples = body.example?.body_text?.[0] ?? [];
    const next = [...currentExamples];
    while (next.length < detectedVars.length) next.push('');
    const pos = detectedVars.indexOf(varIdx);
    if (pos === -1) return;
    next[pos] = value;
    onChange(setComponent(components, {
      type: 'BODY', text: body.text,
      example: { body_text: [next] },
    }, 'BODY'));
  };

  // ─── FOOTER ───
  const setFooterText = (text: string) => {
    if (!text) onChange(setComponent(components, null, 'FOOTER'));
    else onChange(setComponent(components, { type: 'FOOTER', text }, 'FOOTER'));
  };

  // ─── BUTTONS ───
  const updateButtons = (next: HsmButton[]) => {
    if (next.length === 0) onChange(setComponent(components, null, 'BUTTONS'));
    else onChange(setComponent(components, { type: 'BUTTONS', buttons: next }, 'BUTTONS'));
  };

  const addButton = (kind: HsmButton['type']) => {
    const cur = buttons?.buttons ?? [];
    if (cur.length >= 3) return;
    if (kind === 'QUICK_REPLY') updateButtons([...cur, { type: 'QUICK_REPLY', text: '' }]);
    if (kind === 'URL') updateButtons([...cur, { type: 'URL', text: '', url: '' }]);
    if (kind === 'PHONE_NUMBER') updateButtons([...cur, { type: 'PHONE_NUMBER', text: '', phone_number: '' }]);
  };

  const updateButton = (idx: number, patch: Partial<HsmButton>) => {
    if (!buttons) return;
    const next = buttons.buttons.map((b, i) => (i === idx ? { ...b, ...patch } as HsmButton : b));
    updateButtons(next);
  };

  const removeButton = (idx: number) => {
    if (!buttons) return;
    updateButtons(buttons.buttons.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-6">
      {/* ── HEADER ── */}
      <section className="border-t border-zinc-200 pt-4">
        <h3 className="text-sm font-semibold mb-2">HEADER (opcional)</h3>
        <select
          value={header?.format ?? 'none'}
          onChange={(e) => setHeaderType(e.target.value as 'none' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT')}
          className="border border-zinc-300 rounded px-3 py-2 text-sm"
        >
          <option value="none">Nenhum</option>
          <option value="TEXT">Texto</option>
          <option value="IMAGE">Imagem</option>
          <option value="VIDEO">Vídeo</option>
          <option value="DOCUMENT">Documento</option>
        </select>
        {header && 'format' in header && header.format === 'TEXT' && 'text' in header && (
          <input
            value={header.text}
            onChange={(e) => setHeaderText(e.target.value)}
            maxLength={60}
            placeholder="Texto do cabeçalho (max 60 chars)"
            className="mt-2 w-full border border-zinc-300 rounded px-3 py-2 text-sm"
          />
        )}
        {header && 'format' in header && header.format !== 'TEXT' && (
          <p className="text-xs text-zinc-500 mt-2">
            Mídia de header é enviada por URL no momento do disparo da campanha.
          </p>
        )}
      </section>

      {/* ── BODY ── */}
      <section className="border-t border-zinc-200 pt-4">
        <h3 className="text-sm font-semibold mb-2">BODY (obrigatório)</h3>
        <textarea
          value={body?.text ?? ''}
          onChange={(e) => setBodyText(e.target.value)}
          rows={5}
          maxLength={1024}
          placeholder="Olá {{1}}! Sua troca de óleo na {{2}} foi um sucesso. Aproveite 10% off na próxima."
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm font-mono"
        />
        <div className="text-xs text-zinc-500 mt-1">
          Use {'{{1}}, {{2}}, …'} para variáveis. {body?.text.length ?? 0}/1024 chars.
        </div>
        {detectedVars.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="text-xs font-medium text-zinc-700">
              Exemplos (obrigatório para submissão à Meta):
            </div>
            {detectedVars.map((v) => (
              <div key={v} className="flex items-center gap-2 text-sm">
                <span className="font-mono w-12 text-zinc-600">{`{{${v}}}`}</span>
                <input
                  value={body?.example?.body_text?.[0]?.[detectedVars.indexOf(v)] ?? ''}
                  onChange={(e) => setBodyExample(v, e.target.value)}
                  placeholder={`Exemplo para variável ${v}`}
                  className="flex-1 border border-zinc-300 rounded px-2 py-1"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── FOOTER ── */}
      <section className="border-t border-zinc-200 pt-4">
        <h3 className="text-sm font-semibold mb-2">FOOTER (opcional, max 60 chars)</h3>
        <input
          value={footer?.text ?? ''}
          onChange={(e) => setFooterText(e.target.value)}
          maxLength={60}
          placeholder="Lubritec — 30 anos cuidando do seu motor"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm"
        />
      </section>

      {/* ── BUTTONS ── */}
      <section className="border-t border-zinc-200 pt-4">
        <h3 className="text-sm font-semibold mb-2">BUTTONS (opcional, até 3)</h3>
        <div className="space-y-2">
          {(buttons?.buttons ?? []).map((b, i) => (
            <div key={i} className="border border-zinc-200 rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600">{b.type}</span>
                <button onClick={() => removeButton(i)} className="text-red-600 p-1 hover:bg-red-50 rounded">
                  <X size={14} />
                </button>
              </div>
              <input
                value={b.text}
                onChange={(e) => updateButton(i, { text: e.target.value })}
                placeholder="Texto do botão (max 25 chars)"
                maxLength={25}
                className="w-full border border-zinc-300 rounded px-2 py-1 text-sm"
              />
              {b.type === 'URL' && (
                <input
                  value={b.url}
                  onChange={(e) => updateButton(i, { url: e.target.value })}
                  placeholder="https://..."
                  className="w-full border border-zinc-300 rounded px-2 py-1 text-sm font-mono"
                />
              )}
              {b.type === 'PHONE_NUMBER' && (
                <input
                  value={b.phone_number}
                  onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                  placeholder="+5511999999999"
                  className="w-full border border-zinc-300 rounded px-2 py-1 text-sm font-mono"
                />
              )}
            </div>
          ))}
        </div>
        {(buttons?.buttons.length ?? 0) < 3 && (
          <div className="flex gap-2 mt-2 text-sm">
            <button onClick={() => addButton('QUICK_REPLY')} className="inline-flex items-center gap-1 px-2 py-1 border border-zinc-300 rounded hover:bg-zinc-50">
              <Plus size={12} /> Quick Reply
            </button>
            <button onClick={() => addButton('URL')} className="inline-flex items-center gap-1 px-2 py-1 border border-zinc-300 rounded hover:bg-zinc-50">
              <Plus size={12} /> URL
            </button>
            <button onClick={() => addButton('PHONE_NUMBER')} className="inline-flex items-center gap-1 px-2 py-1 border border-zinc-300 rounded hover:bg-zinc-50">
              <Plus size={12} /> Phone
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
