import { useState } from 'react';
import { useCreateInstance } from './api';

interface Props {
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function UazapiSetupStep({ onCreated, onCancel }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.uazapi.com');
  const [adminToken, setAdminToken] = useState('');
  const create = useCreateInstance();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        provider: 'uazapi',
        displayName,
        uazapi: {
          baseUrl: baseUrl || undefined,
          adminToken: adminToken || undefined,
        },
      },
      { onSuccess: (row) => onCreated(row.id) },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Nome de exibição</span>
        <input
          required
          minLength={1}
          maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ex: Atendimento Lubritec"
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">URL da UazAPI</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 font-mono text-sm"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Admin Token (opcional — usa o do .env se vazio)</span>
        <input
          type="password"
          value={adminToken}
          onChange={(e) => setAdminToken(e.target.value)}
          className="mt-1 w-full border border-zinc-300 rounded px-3 py-2 font-mono text-sm"
        />
      </label>
      {create.error && (
        <div className="text-sm text-red-600">
          {create.error instanceof Error ? create.error.message : String(create.error)}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={create.isPending || !displayName}
          className="px-4 py-2 bg-lc-navy text-white rounded disabled:opacity-50"
        >
          {create.isPending ? 'Criando...' : 'Criar e conectar'}
        </button>
      </div>
    </form>
  );
}
