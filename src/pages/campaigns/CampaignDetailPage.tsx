import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, Pause, Play, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useCampaign, usePauseCampaign, useResumeCampaign,
  useCancelCampaign, useDeleteCampaign,
} from '@/features/campaigns/api';
import { useAuthStore } from '@/features/auth/store';
import { StatusBadge } from '@/features/campaigns/StatusBadge';
import { ValidityBadge } from '@/features/campaigns/ValidityBadge';
import { CampaignFunnel } from '@/features/campaigns/CampaignFunnel';
import { CampaignAuditQueueTab } from '@/features/campaigns/CampaignAuditQueueTab';
import { CampaignUnqualifiedTab } from '@/features/campaigns/CampaignUnqualifiedTab';
import { DispatchProgress } from '@/features/campaigns/DispatchProgress';
import { RecipientsTable } from '@/features/campaigns/RecipientsTable';
import { formatDateTime } from '@/features/campaigns/helpers';

export default function CampaignDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const { data, isLoading } = useCampaign(id);
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const cancel = useCancelCampaign();
  const del = useDeleteCampaign();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (isLoading || !data) {
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  }

  const isRunningOrPaused = data.status === 'running' || data.status === 'paused';
  const isCancellable = ['scheduled', 'running', 'paused', 'draft'].includes(data.status);
  const onActionError = (e: unknown) => {
    toast.error(e instanceof Error ? e.message : 'Falha ao executar ação.');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-y-auto">
      <Button asChild variant="ghost" size="sm" className="self-start mb-2">
        <Link to="/campanhas"><ChevronLeft className="h-4 w-4 mr-1" /> Voltar</Link>
      </Button>

      <div className="flex justify-between items-start mb-4 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{data.name}</h1>
            <StatusBadge status={data.status} />
            <ValidityBadge campaign={data} />
          </div>
          {data.description && <p className="text-sm text-muted-foreground mt-1">{data.description}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            Criada por {data.createdBy.name} · {formatDateTime(data.createdAt)}
            {data.startedAt && ` · disparada ${formatDateTime(data.startedAt)}`}
            {data.completedAt && ` · concluída ${formatDateTime(data.completedAt)}`}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {data.status === 'running' && (
            <Button size="sm" variant="outline" onClick={() => pause.mutate(id, {
              onSuccess: () => toast.success('Pausada.'),
              onError: onActionError,
            })}>
              <Pause className="h-4 w-4 mr-1" /> Pausar
            </Button>
          )}
          {data.status === 'paused' && (
            <Button size="sm" variant="outline" onClick={() => resume.mutate(id, {
              onSuccess: () => toast.success('Retomada.'),
              onError: onActionError,
            })}>
              <Play className="h-4 w-4 mr-1" /> Retomar
            </Button>
          )}
          {isCancellable && (
            <Button size="sm" variant="outline" className="text-destructive border-destructive/40"
              onClick={() => cancel.mutate(id, {
                onSuccess: () => toast.success('Cancelada.'),
                onError: onActionError,
              })}
            >
              <X className="h-4 w-4 mr-1" /> Cancelar
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" className="text-destructive border-destructive/40"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Apagar
            </Button>
          )}
        </div>
      </div>

      {isRunningOrPaused && (
        <div className="rounded-lg border border-border bg-card p-4 mb-4">
          <DispatchProgress campaign={data} />
        </div>
      )}

      <Tabs defaultValue="funnel" className="mb-4">
        <TabsList>
          <TabsTrigger value="funnel">Funil</TabsTrigger>
          <TabsTrigger value="audit">Fila cega (auditoria IA)</TabsTrigger>
          <TabsTrigger value="unqualified">Não qualificados</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel">
          <div className="rounded-lg border border-border bg-card p-4 mb-4">
            <h3 className="text-sm font-semibold mb-3">Funil ROI</h3>
            <CampaignFunnel funnel={data.funnel} campaignId={id} />
          </div>

          <div className="rounded-lg border border-border bg-card p-4 mb-4">
            <h3 className="text-sm font-semibold mb-2">Mensagem disparada</h3>
            {data.dispatchedMediaUrl && (
              <img src={data.dispatchedMediaUrl} alt="" className="mb-2 max-w-xs max-h-40 rounded" />
            )}
            {data.dispatchedMessage?.trim() ? (
              <pre className="text-xs bg-muted/30 p-2 rounded whitespace-pre-wrap">{data.dispatchedMessage}</pre>
            ) : (
              <p className="text-xs text-muted-foreground italic">Sem prévia da mensagem.</p>
            )}
          </div>

          <RecipientsTable campaignId={id} campaignStatus={data.status} />
        </TabsContent>

        <TabsContent value="audit">
          <div className="rounded-lg border border-border bg-card p-4">
            <CampaignAuditQueueTab campaignId={id} />
          </div>
        </TabsContent>

        <TabsContent value="unqualified">
          <div className="rounded-lg border border-border bg-card p-4">
            <CampaignUnqualifiedTab campaignId={id} />
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. Os destinatários e referências em conversas serão removidos.
              Conversas históricas continuam disponíveis (sem vínculo com a campanha).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => del.mutate(id, {
                onSuccess: () => { toast.success('Apagada.'); navigate('/campanhas'); },
                onError: onActionError,
              })}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
