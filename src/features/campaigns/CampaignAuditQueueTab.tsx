import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listAuditSamples, claimAuditSample, recordAuditOutcome,
} from './api';
import type { PublicAuditSample, LeadQualityFeedback } from '@shared/types';

interface Props { campaignId: string }

export function CampaignAuditQueueTab({ campaignId }: Props) {
  const qc = useQueryClient();
  const { data: samples = [], isLoading } = useQuery({
    queryKey: ['audit-samples', campaignId],
    queryFn: () => listAuditSamples(campaignId),
  });

  const claimMut = useMutation({
    mutationFn: () => claimAuditSample(campaignId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-samples', campaignId] }),
  });

  const pending = samples.filter((s) => s.status === 'pending');
  const myAssigned = samples.filter((s) => s.status === 'assigned');
  const contacted = samples.filter((s) => s.status === 'contacted');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Fila cega de auditoria</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            10% dos leads que a IA marcou "não qualificados" caem nesta fila.
            Você contata <strong>sem ver a decisão da IA</strong> e avalia se o lead era bom.
            Leads marcados "bom" aqui = falsos negativos (a IA descartou um lead que era bom).
          </p>
          <p className="text-xs">
            <strong>Recompensa:</strong> leads que você marcar "bom" voltam pra sua fila comercial com prioridade.
          </p>
        </CardContent>
      </Card>

      {isLoading && <p>Carregando...</p>}

      <section>
        <h3 className="font-medium mb-2">Disponível pra revisão ({pending.length})</h3>
        <Button onClick={() => claimMut.mutate()} disabled={!pending.length || claimMut.isPending}>
          {claimMut.isPending ? 'Pegando...' : 'Pegar próximo lead'}
        </Button>
      </section>

      <section>
        <h3 className="font-medium mb-2">Atribuídos a mim ({myAssigned.length})</h3>
        {myAssigned.map((s) => (
          <AssignedCard key={s.id} sample={s} campaignId={campaignId} />
        ))}
      </section>

      <section>
        <h3 className="font-medium mb-2">Já contatados ({contacted.length})</h3>
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">Lead</th><th className="text-left">Outcome</th><th className="text-left">Quando</th></tr></thead>
          <tbody>
            {contacted.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="py-1">{s.leadName}</td>
                <td className="py-1">{s.outcome === 'good' ? 'Bom (falso negativo)' : 'Ruim (confirmado)'}</td>
                <td className="py-1">{s.contactedAt ? new Date(s.contactedAt).toLocaleString('pt-BR') : '-'}</td>
              </tr>
            ))}
            {contacted.length === 0 && !isLoading && (
              <tr><td colSpan={3} className="text-center text-muted-foreground py-4">Nenhum contatado ainda.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AssignedCard({ sample, campaignId }: { sample: PublicAuditSample; campaignId: string }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const mut = useMutation({
    mutationFn: (outcome: LeadQualityFeedback) => recordAuditOutcome({ id: sample.id, outcome, notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit-samples', campaignId] }),
  });

  return (
    <Card className="mb-2">
      <CardContent className="pt-4 space-y-2">
        <div><strong>{sample.leadName}</strong> — {sample.leadPhone ?? 'sem telefone'} — {sample.leadCnpj ?? 'sem CNPJ'}</div>
        <Textarea
          placeholder="O que você descobriu ao contatar? (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2">
          <Button onClick={() => mut.mutate('good')} disabled={mut.isPending}>Era um bom lead</Button>
          <Button variant="destructive" onClick={() => mut.mutate('bad')} disabled={mut.isPending}>
            Era ruim mesmo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
