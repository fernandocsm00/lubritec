import type { ProviderKind } from '@shared/types';

interface Props {
  onSelect: (kind: ProviderKind) => void;
}

export function ProviderPickerStep({ onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <button
        onClick={() => onSelect('uazapi')}
        className="border border-zinc-200 rounded-lg p-5 text-left hover:border-lc-navy hover:shadow-sm transition"
      >
        <h3 className="font-semibold text-lg mb-2">UazAPI (não oficial)</h3>
        <ul className="text-sm text-zinc-600 space-y-1 mb-4">
          <li>• Pareamento via QR code</li>
          <li>• Mensagens livres sem limite</li>
          <li>• Custo fixo mensal</li>
          <li>• ⚠️ Risco de banimento pela Meta</li>
        </ul>
        <span className="inline-block px-3 py-1.5 bg-lc-navy text-white text-sm rounded">
          Selecionar
        </span>
      </button>
      <button
        onClick={() => onSelect('meta_cloud')}
        disabled
        className="border border-zinc-200 rounded-lg p-5 text-left opacity-60 cursor-not-allowed"
      >
        <h3 className="font-semibold text-lg mb-2">WhatsApp Cloud API (Meta)</h3>
        <ul className="text-sm text-zinc-600 space-y-1 mb-4">
          <li>• Configuração via Meta Business Manager</li>
          <li>• Templates aprovados</li>
          <li>• Zero risco de ban</li>
          <li>• Custo por conversa</li>
        </ul>
        <span className="inline-block px-3 py-1.5 bg-zinc-300 text-zinc-600 text-sm rounded">
          Em breve (Plano B)
        </span>
      </button>
    </div>
  );
}
