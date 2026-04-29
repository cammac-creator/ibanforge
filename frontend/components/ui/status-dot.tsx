import { cn } from '@/lib/utils';

type Kind = 'live' | 'ok' | 'err' | 'warn' | 'info';

interface StatusDotProps {
  kind?: Kind;
  className?: string;
  ariaLabel?: string;
}

const colorByKind: Record<Kind, string> = {
  live: 'var(--live)',
  ok: 'var(--ok)',
  err: 'var(--err)',
  warn: 'var(--warn)',
  info: 'var(--info)',
};

/**
 * 8px status dot. `live` variant gently pulses + has a glow ring (used in
 * eyebrows and status indicators). Other variants are static.
 */
export function StatusDot({ kind = 'live', className, ariaLabel }: StatusDotProps) {
  return (
    <span
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        kind === 'live' && 'animate-pulse-live',
        className,
      )}
      style={{
        backgroundColor: colorByKind[kind],
        boxShadow: kind === 'live' ? '0 0 0 3px rgba(34, 197, 94, 0.18)' : undefined,
      }}
    />
  );
}
