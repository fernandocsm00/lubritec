import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listUnqualifiedLeads, type UnqualifiedLead } from './api';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

interface Props { campaignId: string }

export function CampaignUnqualifiedTab({ campaignId }: Props) {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['campaign-unqualified', campaignId],
    queryFn: () => listUnqualifiedLeads(campaignId),
  });
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return leads;
    const s = search.toLowerCase();
    return leads.filter((l: UnqualifiedLead) =>
      l.leadName.toLowerCase().includes(s) ||
      (l.leadCnpj?.includes(s) ?? false) ||
      (l.decisionReason?.toLowerCase().includes(s) ?? false),
    );
  }, [leads, search]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 text-sm text-muted-foreground space-y-1">
          <p>
            Leads que a IA marcou <strong>não qualificados</strong> nesta campanha.
            Util pra reciclar em campanhas futuras quando o produto/contexto mudar.
          </p>
          <p className="text-xs">
            <strong>Atenção:</strong> esta lista não substitui a fila cega — escolher por aqui mantém o vies da IA.
            Use só pra reciclagem direcionada (ex.: novo produto que atende um perfil que antes não cabia).
          </p>
        </CardContent>
      </Card>

      <Input
        placeholder="Buscar por nome, CNPJ, motivo..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading && <p>Carregando...</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="pb-2">Lead</th>
            <th className="pb-2">CPF/CNPJ</th>
            <th className="pb-2">Motivo IA</th>
            <th className="pb-2">Idade</th>
            <th className="pb-2">Tentativas</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((l: UnqualifiedLead) => (
            <tr key={l.leadId} className="border-t">
              <td className="py-1">{l.leadName}</td>
              <td className="py-1">{l.leadCnpj ?? '-'}</td>
              <td className="py-1 max-w-xs truncate" title={l.decisionReason ?? ''}>
                {l.decisionReason ?? '(sem motivo registrado)'}
              </td>
              <td className="py-1">{l.ageInDays}d</td>
              <td className="py-1">{l.reattemptCount}</td>
            </tr>
          ))}
          {filtered.length === 0 && !isLoading && (
            <tr><td colSpan={5} className="text-center text-muted-foreground py-4">Nenhum lead encontrado.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
