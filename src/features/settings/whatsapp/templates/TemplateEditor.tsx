import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useCreateTemplate, useUpdateTemplate } from './api';
import { TemplateComponentsEditor } from './TemplateComponentsEditor';
import { TemplatePreview } from './TemplatePreview';
import { HSM_CATEGORIES } from '@shared/types';
import type { HsmComponent, HsmCategory, HsmTemplateRecord } from './types';

interface Props {
  open: boolean;
  instanceId: string;
  /** Quando passado, abre em modo edição (só funciona pra status === 'DRAFT'). */
  template?: HsmTemplateRecord | null;
  onClose: () => void;
}

const LANGUAGES = [
  { value: 'pt_BR', label: 'Português (Brasil)' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'es_LA', label: 'Español (Latinoamérica)' },
];

export function TemplateEditor({ open, instanceId, template, onClose }: Props) {
  const isEdit = !!template;
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('pt_BR');
  const [category, setCategory] = useState<HsmCategory>('MARKETING');
  const [components, setComponents] = useState<HsmComponent[]>([
    { type: 'BODY', text: '' },
  ]);
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string | null>(null);

  const create = useCreateTemplate(instanceId);
  const update = useUpdateTemplate(instanceId);
  const mutation = isEdit ? update : create;

  // Carrega valores do template ao abrir em modo edit.
  useEffect(() => {
    if (open && template) {
      setName(template.name);
      setLanguage(template.language);
      setCategory(template.category);
      setComponents((template.components ?? []) as HsmComponent[]);
      setHeaderMediaUrl(template.headerMediaUrl ?? null);
    } else if (open && !template) {
      setName('');
      setLanguage('pt_BR');
      setCategory('MARKETING');
      setComponents([{ type: 'BODY', text: '' }]);
      setHeaderMediaUrl(null);
    }
  }, [open, template]);

  if (!open) return null;

  const reset = () => {
    setName('');
    setLanguage('pt_BR');
    setCategory('MARKETING');
    setComponents([{ type: 'BODY', text: '' }]);
    setHeaderMediaUrl(null);
    create.reset();
    update.reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const nameValid = /^[a-z0-9_]+$/.test(name);
  const bodyComp = components.find((c) => c.type === 'BODY');
  const hasBody = !!bodyComp && 'text' in bodyComp && bodyComp.text.trim().length > 0;

  // HEADER de texto vazio → Meta rejeita (subcode 2388043). Bloqueia salvar.
  const headerComp = components.find((c) => c.type === 'HEADER');
  const headerTextEmpty = !!headerComp && 'format' in headerComp
    && headerComp.format === 'TEXT'
    && !('text' in headerComp && headerComp.text.trim().length > 0);

  // Variáveis do BODY devem ser numéricas ({{1}}…), não {{nome}}.
  const bodyText = bodyComp && 'text' in bodyComp ? bodyComp.text : '';
  const invalidVars = [...new Set(
    (bodyText.match(/\{\{[^}]*\}\}/g) ?? []).filter((p) => !/^\{\{\s*\d+\s*\}\}$/.test(p)),
  )];
  const hasInvalidVars = invalidVars.length > 0;

  // Header de imagem sem imagem enviada: pode salvar rascunho, mas a Meta rejeita.
  const headerIsImage = !!headerComp && 'format' in headerComp && headerComp.format === 'IMAGE';
  const headerImageMissing = headerIsImage
    && !(headerComp && 'example' in headerComp && headerComp.example?.header_handle?.[0]);

  const canSave = nameValid && hasBody && !headerTextEmpty && !hasInvalidVars;
  const canSubmitMeta = canSave && !headerImageMissing;

  const submit = (asDraft: boolean) => {
    const body = { name, language, category, components, headerMediaUrl, submitNow: !asDraft };
    if (isEdit && template) {
      update.mutate(
        { templateId: template.id, body },
        { onSuccess: () => handleClose() },
      );
    } else {
      create.mutate(body, { onSuccess: () => handleClose() });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[95vh] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold">
            {isEdit ? `Editar rascunho — ${template?.name}` : 'Novo template HSM'}
          </h2>
          <button onClick={handleClose} className="p-1 hover:bg-zinc-100 rounded">
            <X size={20} />
          </button>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 overflow-y-auto">
          {/* ── EDITOR ── */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-zinc-700">Nome (snake_case)</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  placeholder="boas_vindas_pos_troca"
                  className={`mt-1 w-full border rounded px-3 py-2 text-sm font-mono ${
                    name && !nameValid ? 'border-red-400' : 'border-zinc-300'
                  }`}
                />
                {name && !nameValid && (
                  <div className="text-xs text-red-600 mt-1">Apenas a-z, 0-9 e _</div>
                )}
              </label>
              <label className="block">
                <span className="text-xs font-medium text-zinc-700">Idioma</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 text-sm"
                >
                  {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </label>
            </div>
            <fieldset>
              <legend className="text-xs font-medium text-zinc-700 mb-1">Categoria</legend>
              <div className="flex gap-2">
                {HSM_CATEGORIES.map((cat) => (
                  <label key={cat} className="inline-flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      name="category"
                      checked={category === cat}
                      onChange={() => setCategory(cat)}
                    />
                    {cat}
                  </label>
                ))}
              </div>
            </fieldset>

            <TemplateComponentsEditor
              components={components}
              onChange={setComponents}
              instanceId={instanceId}
              headerMediaUrl={headerMediaUrl}
              onHeaderMediaUrlChange={setHeaderMediaUrl}
            />

            {headerTextEmpty && (
              <div className="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded px-3 py-2">
                O HEADER está como "Texto" mas está vazio. Preencha o texto do cabeçalho ou mude o HEADER para "Nenhum".
              </div>
            )}
            {hasInvalidVars && (
              <div className="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded px-3 py-2">
                Variáveis inválidas no BODY: {invalidVars.join(', ')}. A Meta só aceita variáveis numéricas — use {'{{1}}, {{2}}, …'}.
              </div>
            )}
            {mutation.error && (
              <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded px-3 py-2">
                {mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}
              </div>
            )}
          </div>

          {/* ── PREVIEW ── */}
          <div className="md:sticky md:top-0 self-start">
            <div className="text-xs font-medium text-zinc-700 mb-2">Preview</div>
            <TemplatePreview components={components} headerMediaUrl={headerMediaUrl} />
          </div>
        </div>

        <footer className="border-t border-zinc-200 px-6 py-4 flex justify-end gap-2">
          <button onClick={handleClose} className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded text-sm">
            Cancelar
          </button>
          <button
            onClick={() => submit(true)}
            disabled={!canSave || mutation.isPending}
            className="px-4 py-2 border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-50 text-sm"
          >
            {isEdit ? 'Salvar alterações' : 'Salvar rascunho'}
          </button>
          <button
            onClick={() => submit(false)}
            disabled={!canSubmitMeta || mutation.isPending}
            title={headerImageMissing ? 'Envie a imagem do header antes de submeter à Meta' : undefined}
            className="px-4 py-2 bg-lc-navy text-white rounded disabled:opacity-50 text-sm"
          >
            {mutation.isPending ? 'Enviando...' : 'Enviar para aprovação'}
          </button>
        </footer>
      </div>
    </div>
  );
}
