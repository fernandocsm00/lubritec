import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useWebhookInfo } from './api';

interface Props {
  instanceId: string;
  onDone: () => void;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-2 p-1.5 rounded hover:bg-zinc-100"
      aria-label="Copiar"
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
    </button>
  );
}

export function WebhookInfoStep({ instanceId, onDone }: Props) {
  const { data, isLoading } = useWebhookInfo(instanceId);

  if (isLoading || !data) {
    return <div className="text-zinc-500">Carregando informações do webhook...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium mb-2">✅ Linha criada e credenciais validadas pela Meta.</p>
        <p>Última etapa: configure o webhook no seu Meta App pra começar a receber mensagens.</p>
      </div>

      <ol className="text-sm space-y-3 list-decimal list-inside">
        <li>
          Acesse <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer"
          className="text-lc-navy underline">developers.facebook.com/apps</a> → seu app → produto
          {' '}<strong>WhatsApp</strong> → <strong>Configuration</strong> → Webhook.
        </li>
        <li>Em "Callback URL", cole:
          <div className="flex items-center bg-zinc-50 border border-zinc-200 rounded px-3 py-2 mt-1 font-mono text-xs break-all">
            <span className="flex-1">{data.callbackUrl}</span>
            <CopyButton value={data.callbackUrl} />
          </div>
        </li>
        <li>Em "Verify Token", cole:
          <div className="flex items-center bg-zinc-50 border border-zinc-200 rounded px-3 py-2 mt-1 font-mono text-xs break-all">
            <span className="flex-1">{data.verifyToken}</span>
            <CopyButton value={data.verifyToken} />
          </div>
        </li>
        <li>Clique <strong>"Verify and save"</strong> no painel da Meta.</li>
        <li>Inscreva-se nos eventos: <strong>messages</strong> e <strong>message_template_status_update</strong> (este último necessário no Plano C).</li>
      </ol>

      <div className="flex items-center gap-2 text-sm">
        <span className={data.subscribed ? 'text-emerald-600' : 'text-zinc-500'}>
          {data.subscribed ? '🟢 Webhook verificado pela Meta' : '⌛ Aguardando verificação da Meta...'}
        </span>
      </div>

      <div className="flex justify-end pt-2">
        <button type="button" onClick={onDone} className="px-4 py-2 bg-lc-navy text-white rounded">
          Concluir
        </button>
      </div>
    </div>
  );
}
