import type { QualificationPath } from '@shared/types';

interface Props { path: QualificationPath | null }

export function QualificationPathBadge({ path }: Props) {
  if (!path) return <span className="text-xs text-muted-foreground">— sem decisão da IA —</span>;
  if (path === 'campaign_direct') return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
      Qualificado direto via campanha
    </span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700">
      Qualificado após conversa
    </span>
  );
}
