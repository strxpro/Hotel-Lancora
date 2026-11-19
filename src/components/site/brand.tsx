import { cn } from '@/lib/utils';

export function AnchorMark({ className, strokeWidth = 1.4 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 48 56" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="24" cy="7" r="4.2" />
      <path d="M24 11.2V52" />
      <path d="M15 20h18" />
      <path d="M5 34c1.6 10.5 9.4 18 19 18s17.4-7.5 19-18" />
      <path d="M5 34l-2.6 4.4M5 34l5 1.6M43 34l2.6 4.4M43 34l-5 1.6" />
    </svg>
  );
}

export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <AnchorMark className={cn('shrink-0', compact ? 'h-6 w-5' : 'h-8 w-7')} />
      <span className="flex flex-col leading-none">
        <span className="text-[0.55rem] font-semibold tracking-[0.42em]">HOTEL</span>
        <span className="serif mt-0.5 text-[1.45rem] tracking-[0.06em]">L’Ancora</span>
      </span>
    </span>
  );
}

export function Stars({ n = 3, className }: { n?: number; className?: string }) {
  return (
    <span className={cn('inline-flex gap-1', className)} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <svg key={i} viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current">
          <path d="M5 0l1.2 3.6H10L6.9 5.8 8 9.5 5 7.2 2 9.5l1.1-3.7L0 3.6h3.8z" />
        </svg>
      ))}
    </span>
  );
}
