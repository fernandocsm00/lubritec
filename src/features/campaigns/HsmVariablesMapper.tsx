import type { HsmTemplateRecord, CampaignHsmVariable, HsmBody } from '@shared/types';

interface Props {
  template: HsmTemplateRecord;
  variables: CampaignHsmVariable[];
  onChange: (vars: CampaignHsmVariable[]) => void;
}

const LEAD_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'name', label: 'Nome' },
  { value: 'phone', label: 'Telefone' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'Email' },
  { value: 'notes', label: 'Observações' },
];

function detectIndices(template: HsmTemplateRecord): number[] {
  const body = template.components.find((c) => c.type === 'BODY') as HsmBody | undefined;
  if (!body) return [];
  const matches = body.text.match(/\{\{(\d+)\}\}/g) ?? [];
  return Array.from(new Set(matches)).map((m) => parseInt(m.slice(2, -2), 10)).sort((a, b) => a - b);
}

export function HsmVariablesMapper({ template, variables, onChange }: Props) {
  const indices = detectIndices(template);

  if (indices.length === 0) {
    return (
      <div className="text-sm text-zinc-500 italic">
        Este template não tem variáveis — nada a mapear.
      </div>
    );
  }

  const findVar = (idx: number) => variables.find((v) => v.index === idx);

  const update = (idx: number, patch: Partial<CampaignHsmVariable>) => {
    const existing = findVar(idx);
    const next: CampaignHsmVariable = existing
      ? { ...existing, ...patch }
      : { index: idx, source: 'static', value: '', ...patch };
    const others = variables.filter((v) => v.index !== idx);
    onChange([...others, next].sort((a, b) => a.index - b.index));
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-zinc-700">Mapeamento de variáveis</div>
      <p className="text-xs text-zinc-500">
        Para cada variável do template, escolha entre um valor fixo (mesmo pra todos os destinatários)
        ou um campo do lead (varia por destinatário).
      </p>
      <div className="space-y-2">
        {indices.map((idx) => {
          const v = findVar(idx);
          return (
            <div key={idx} className="border border-zinc-200 rounded p-3 space-y-2">
              <div className="text-sm font-mono text-zinc-700">{`{{${idx}}}`}</div>
              <div className="flex items-center gap-3 text-sm">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name={`src-${idx}`}
                    checked={v?.source !== 'lead_field'}
                    onChange={() => update(idx, { source: 'static', value: '' })}
                  />
                  Valor fixo
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name={`src-${idx}`}
                    checked={v?.source === 'lead_field'}
                    onChange={() => update(idx, { source: 'lead_field', value: 'name' })}
                  />
                  Campo do lead
                </label>
              </div>
              {v?.source === 'lead_field' ? (
                <select
                  value={v.value}
                  onChange={(e) => update(idx, { value: e.target.value })}
                  className="w-full border border-zinc-300 rounded px-2 py-1 text-sm"
                >
                  {LEAD_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={v?.value ?? ''}
                  onChange={(e) => update(idx, { source: 'static', value: e.target.value })}
                  placeholder="Valor para todos os destinatários"
                  className="w-full border border-zinc-300 rounded px-2 py-1 text-sm"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
