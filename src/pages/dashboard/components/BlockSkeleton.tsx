export function BlockSkeleton({ height = 120 }: { height?: number }) {
  return (
    <div
      aria-busy="true"
      className="rounded-xl bg-slate-100 animate-pulse"
      style={{ height }}
    />
  );
}
