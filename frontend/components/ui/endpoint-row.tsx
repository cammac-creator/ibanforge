import { cn } from '@/lib/utils';

type Method = 'GET' | 'POST' | 'PUT' | 'DEL' | 'DELETE';

interface EndpointRowProps {
  method?: Method;
  path: string;
  price?: string;
  className?: string;
}

const methodColors: Record<Method, { bg: string; fg: string }> = {
  GET: { bg: 'rgba(56, 189, 248, 0.10)', fg: '#38BDF8' },
  POST: { bg: 'rgba(245, 158, 11, 0.10)', fg: 'var(--amber-500)' },
  PUT: { bg: 'rgba(192, 132, 252, 0.10)', fg: '#C084FC' },
  DEL: { bg: 'rgba(239, 68, 68, 0.10)', fg: '#EF4444' },
  DELETE: { bg: 'rgba(239, 68, 68, 0.10)', fg: '#EF4444' },
};

/**
 * One-line API endpoint display. Slashes greyed out, {params} highlighted in
 * amber, method chip on the left, price on the right. Used in landing
 * Endpoints section and pricing table.
 */
export function EndpointRow({ method = 'POST', path, price, className }: EndpointRowProps) {
  const m = methodColors[method] ?? methodColors.POST;
  const parts = path.split('/').filter(Boolean);
  const label = method === 'DELETE' ? 'DEL' : method;

  return (
    <div className={cn('endpoint-row py-2', className)}>
      <span
        className="inline-flex items-center justify-center px-2 py-1 rounded-md font-mono text-[10px] font-bold uppercase tracking-caps"
        style={{ background: m.bg, color: m.fg }}
      >
        {label}
      </span>
      <span
        className="font-mono text-sm"
        style={{ color: 'var(--fg-1)', letterSpacing: '-0.005em' }}
      >
        {parts.map((p, i) => (
          <span key={i}>
            <span style={{ color: 'var(--fg-4)' }}>/</span>
            {p.startsWith(':') || (p.startsWith('{') && p.endsWith('}')) ? (
              <span style={{ color: 'var(--amber-400)' }}>{p}</span>
            ) : (
              <span>{p}</span>
            )}
          </span>
        ))}
      </span>
      {price && (
        <span className="font-mono text-xs" style={{ color: 'var(--fg-3)' }}>
          {price}
        </span>
      )}
    </div>
  );
}
