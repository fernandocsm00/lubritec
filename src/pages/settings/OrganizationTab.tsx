import { useEffect, useState } from 'react';
import { getOrgSettings, updateOrgSettings } from './api';

export default function OrganizationTab() {
  const [goal, setGoal] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrgSettings()
      .then((s) => {
        setGoal(s.monthlySalesGoal == null ? '' : String(s.monthlySalesGoal));
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const parsed = goal.trim() === '' ? null : Number(goal.replace(',', '.'));
      if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
        throw new Error('Informe um valor válido (≥ 0).');
      }
      const r = await updateOrgSettings({ monthlySalesGoal: parsed });
      setSavedAt(r.updatedAt);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded && !error) return <div className="p-4 text-sm text-slate-500">Carregando…</div>;

  return (
    <form onSubmit={onSave} className="max-w-md space-y-4 p-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Meta de vendas mensal (R$)
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="ex: 75000"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-lc-navy focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">
          Aparece como barra de progresso no card "Vendas" do Dashboard. Deixe em branco para ocultar.
        </p>
      </div>

      {error && <p className="text-sm text-lc-ruby">{error}</p>}
      {savedAt && !error && <p className="text-sm text-emerald-600">Salvo.</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-lc-navy px-4 py-2 text-sm font-medium text-white hover:bg-lc-navy-deep disabled:opacity-50"
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}
