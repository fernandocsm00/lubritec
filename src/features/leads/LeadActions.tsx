import { useState } from 'react';
import { MoreHorizontal, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { LeadDialog } from './LeadDialog';
import { useDeleteLead, useEnrichLead, type EnrichmentStatus } from './api';
import { translateError } from './translateError';
import type { PublicLead } from '@shared/types';

const ENRICH_MESSAGES: Record<EnrichmentStatus, { type: 'success' | 'info' | 'error'; msg: (phone?: string, err?: string) => string }> = {
  phone_found: {
    type: 'success',
    msg: (phone) => `Telefone encontrado: ${phone}. Lead atualizado.`,
  },
  phone_not_in_brasilapi: {
    type: 'info',
    msg: () => 'CNPJ ativo na BrasilAPI mas sem telefone cadastrado.',
  },
  cnpj_not_found: {
    type: 'info',
    msg: () => 'CNPJ não encontrado na BrasilAPI/Receita Federal.',
  },
  cnpj_inactive: {
    type: 'info',
    msg: (_p, err) => `CNPJ encontrado mas inativo: ${err ?? 'situação não ativa'}.`,
  },
  api_error: {
    type: 'error',
    msg: (_p, err) => `Erro na BrasilAPI: ${err ?? 'desconhecido'}.`,
  },
};

export function LeadActions({ lead }: { lead: PublicLead }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const del = useDeleteLead();
  const enrich = useEnrichLead();
  // Disponibilizamos enriquecimento só pra leads sem phone E com cnpj.
  const canEnrich = !lead.phone && !!lead.cnpj;

  async function onDelete() {
    try {
      await del.mutateAsync(lead.id);
      toast.success('Lead excluído.');
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao excluir.';
      toast.error(msg);
    }
  }

  async function onEnrich() {
    try {
      const result = await enrich.mutateAsync(lead.id);
      const meta = ENRICH_MESSAGES[result.status];
      const text = meta.msg(result.phoneFound, result.errorMessage);
      if (meta.type === 'success') toast.success(text);
      else if (meta.type === 'error') toast.error(text);
      else toast.info(text);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao buscar telefone.';
      toast.error(msg);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Ações para ${lead.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Editar</DropdownMenuItem>
          {canEnrich && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onEnrich} disabled={enrich.isPending}>
                <Search className="mr-2 h-4 w-4" />
                {enrich.isPending ? 'Buscando…' : 'Buscar telefone (BrasilAPI)'}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive">
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LeadDialog lead={lead} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {lead.name}?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
