import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchCaseSheet, reanalyzeCase } from './api';
import { QualificationPathBadge } from './QualificationPathBadge';
import { QuestionsAnswersList } from './QuestionsAnswersList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  leadId: string;
  /** Quando true, exibe botão "Solicitar reanálise" (admin only). */
  isAdmin: boolean;
  /** Link opcional para o deal correspondente. */
  onOpenDeal?: (dealId: string) => void;
}

export function CaseSheet({ leadId, isAdmin, onOpenDeal }: Props) {
  const { data: sheet, isLoading, refetch } = useQuery({
    queryKey: ['case-sheet', leadId],
    queryFn: () => fetchCaseSheet(leadId),
  });
  const [reanalysisOpen, setReanalysisOpen] = useState(false);
  const [reanalysisReason, setReanalysisReason] = useState('');
  const reMut = useMutation({
    mutationFn: () => reanalyzeCase(leadId, reanalysisReason),
    onSuccess: () => { setReanalysisOpen(false); setReanalysisReason(''); refetch(); },
  });

  if (isLoading || !sheet) return <p>Carregando ficha...</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Decisão da IA</CardTitle>
          <QualificationPathBadge path={sheet.qualificationPath} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {sheet.qualified == null ? (
            <p className="text-muted-foreground">Nenhuma decisão registrada.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <strong>Resultado:</strong>
                <span className={sheet.qualified ? 'text-green-700' : 'text-red-700'}>
                  {sheet.qualified ? '✓ Qualificado' : '✗ Não qualificado'}
                </span>
              </div>
              <div><strong>Modelo:</strong> {sheet.model} <span className="text-xs text-muted-foreground">({sheet.promptVersion ?? 'sem versão'})</span></div>
              {sheet.decidedAt && (
                <div><strong>Decidido em:</strong> {new Date(sheet.decidedAt).toLocaleString('pt-BR')}</div>
              )}
              {sheet.decisionReason && (
                <div>
                  <strong>Razão da decisão:</strong>
                  <p className="mt-1 p-2 bg-muted rounded text-sm">{sheet.decisionReason}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {sheet.qualificationPath === 'campaign_direct' && sheet.campaignId && (
        <Card>
          <CardHeader><CardTitle>Contexto da campanha</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><strong>Campanha:</strong> {sheet.campaignName}</div>
            {sheet.qualificationQuestion && (
              <div>
                <strong>Pergunta de qualificação:</strong>
                <p className="mt-1 p-2 bg-muted rounded">{sheet.qualificationQuestion}</p>
              </div>
            )}
            {sheet.firstInboundReply && (
              <div>
                <strong>Primeira resposta do lead:</strong>
                <p className="mt-1 p-2 bg-muted rounded italic">"{sheet.firstInboundReply}"</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sheet.qualificationPath === 'conversation' && sheet.questionsAnswers.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Perguntas e respostas avaliadas</CardTitle></CardHeader>
          <CardContent>
            <QuestionsAnswersList items={sheet.questionsAnswers} />
          </CardContent>
        </Card>
      )}

      {sheet.dealId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Trajetória do deal</CardTitle>
            {onOpenDeal && <Button variant="ghost" size="sm" onClick={() => onOpenDeal(sheet.dealId!)}>Abrir deal →</Button>}
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div><strong>Estágio:</strong> {sheet.dealStage}</div>
            {sheet.dealValue != null && (
              <div><strong>Valor:</strong> R$ {sheet.dealValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            )}
            {sheet.dealLossReason && <div><strong>Motivo de perda:</strong> {sheet.dealLossReason}</div>}
            {sheet.leadQualityFeedback && (
              <div>
                <strong>Feedback do vendedor:</strong>{' '}
                <span className={sheet.leadQualityFeedback === 'good' ? 'text-green-700' : 'text-red-700'}>
                  {sheet.leadQualityFeedback === 'good' ? 'Lead estava bom' : 'Lead mal qualificado'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sheet.closedNoDealAt && (
        <Card>
          <CardHeader><CardTitle>Encerrado sem deal</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div><strong>Em:</strong> {new Date(sheet.closedNoDealAt).toLocaleString('pt-BR')}</div>
            {sheet.closedNoDealReason && (
              <div><strong>Motivo:</strong> {sheet.closedNoDealReason}</div>
            )}
            {sheet.closedNoDealQuality && (
              <div>
                <strong>Feedback:</strong>{' '}
                <span className={sheet.closedNoDealQuality === 'good' ? 'text-green-700' : 'text-red-700'}>
                  {sheet.closedNoDealQuality === 'good' ? 'Lead estava bom' : 'Lead mal qualificado'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && sheet.qualified != null && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setReanalysisOpen(true)}>
            Solicitar reanálise
          </Button>
        </div>
      )}

      <Dialog open={reanalysisOpen} onOpenChange={(o) => !o && setReanalysisOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Solicitar reanálise da decisão</DialogTitle></DialogHeader>
          <Textarea
            placeholder="Por que esta decisão deveria ser revista? (registra no histórico)"
            value={reanalysisReason}
            onChange={(e) => setReanalysisReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReanalysisOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => reMut.mutate()}
              disabled={reanalysisReason.trim().length < 3 || reMut.isPending}
            >
              Solicitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
