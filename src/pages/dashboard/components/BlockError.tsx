export function BlockError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
      <p className="text-slate-500">Falha ao carregar este bloco.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-lc-navy hover:underline"
      >
        Tentar novamente
      </button>
    </div>
  );
}
