import { Pause } from 'lucide-react';

export function HoldIndicator() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 border border-destructive/60 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-mono font-bold leading-none text-destructive"
      title="Sales order is on hold"
      aria-label="Sales order is on hold"
    >
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-destructive">
        <Pause className="h-2 w-2" strokeWidth={3} aria-hidden="true" />
      </span>
      <span>ON HOLD</span>
    </span>
  );
}