import { formatCnpj } from '@/lib/utils';

interface PreviewLead {
  name: string;
  phone: string;
  cnpj: string | null;
}

interface Props {
  body: string;
  mediaUrl: string | null;
  lead: PreviewLead | null;
}

function formatPhoneBR(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  return phone;
}

function interpolate(body: string, lead: PreviewLead): string {
  return body
    .replaceAll('{{nome}}', lead.name)
    .replaceAll('{{telefone}}', formatPhoneBR(lead.phone))
    .replaceAll('{{cnpj}}', lead.cnpj ? formatCnpj(lead.cnpj) : '');
}

export function PreviewMessage({ body, mediaUrl, lead }: Props) {
  if (!lead) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        Selecione um lead pra ver a prévia.
      </div>
    );
  }
  const interpolated = interpolate(body, lead);

  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-sm">
      <div className="text-[10px] uppercase text-muted-foreground mb-2">Como vai chegar pro lead</div>
      <div className="text-xs text-muted-foreground mb-2">{lead.name}</div>
      <div className="bg-emerald-900/40 rounded-lg p-3 text-sm whitespace-pre-wrap break-words">
        {mediaUrl && (
          <img src={mediaUrl} alt="" className="rounded mb-2 max-w-full max-h-40 object-cover" />
        )}
        {interpolated}
      </div>
    </div>
  );
}
