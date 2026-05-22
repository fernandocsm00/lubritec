import { useState } from 'react';
import { useCreateInstance } from './api';

interface Props {
  onCreated: (instanceId: string) => void;
  onCancel: () => void;
}

export function MetaCloudSetupStep({ onCreated, onCancel }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const create = useCreateInstance();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        provider: 'meta_cloud',
        displayName,
        metaCloud: { wabaId, phoneNumberId, accessToken, appSecret },
      },
      { onSuccess: (row) => onCreated(row.id) },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-zinc-600">
        Configure no <a href="https://business.facebook.com/" target="_blank" rel="noreferrer"
        className="text-lc-navy underline">Meta Business Manager</a> e cole as 4 credenciais abaixo.
        A validação acontece via Meta Graph API e leva alguns segundos.
      </p>
      <label className="block">
        <span className="text-sm font-medium">Nome de exibição</span>
        <input required minLength={1} maxLength={80} value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ex: Lubritec Oficial"
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">WABA ID</span>
        <input required value={wabaId} onChange={(e) => setWabaId(e.target.value)}
          placeholder="ID do WhatsApp Business Account"
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 font-mono text-sm" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Phone Number ID</span>
        <input required value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder="ID do número de telefone na Meta"
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 font-mono text-sm" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Permanent Access Token (System User)</span>
        <input required type="password" value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="Token de longa duração com escopo whatsapp_business_messaging"
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 font-mono text-sm" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">App Secret</span>
        <input required type="password" value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          placeholder="App Secret do seu Meta App (usado pra validar webhooks)"
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 font-mono text-sm" />
      </label>
      {create.error && (
        <div className="text-sm text-red-600">
          {create.error instanceof Error ? create.error.message : String(create.error)}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded">
          Voltar
        </button>
        <button type="submit"
          disabled={create.isPending || !displayName || !wabaId || !phoneNumberId || !accessToken || !appSecret}
          className="px-4 py-2 bg-lc-navy text-white rounded disabled:opacity-50">
          {create.isPending ? 'Validando...' : 'Validar e criar'}
        </button>
      </div>
    </form>
  );
}
