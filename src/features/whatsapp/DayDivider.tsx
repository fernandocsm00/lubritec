export function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex justify-center my-3">
      <span className="bg-muted text-muted-foreground text-[11px] font-medium px-3 py-1 rounded shadow-sm">
        {label}
      </span>
    </div>
  );
}
