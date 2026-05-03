export function BlockSkeleton({ height = 120 }: { height?: number }) {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className="rounded-xl bg-slate-100 animate-pulse"
      style={{ height }}
    />
  );
}
