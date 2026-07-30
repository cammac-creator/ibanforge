'use client';

import type { BotDossier } from '@/lib/crm/bot-dossiers';
import { Bar, Empty, HoursStrip, Section, Sparkbars, Stat, relativeDays } from './dossier-bits';

const KIND_LABEL: Record<string, string> = {
  api: 'appel REST direct',
  mcp_http: 'MCP par HTTP',
  mcp_stdio: 'agent IA',
  bot: 'robot déclaré',
  web: 'navigateur',
};

export function BotDossierPanel({ b }: { b: BotDossier }) {
  const refusalRate = b.requests > 0 ? Math.round(((b.paywall + b.badInput) / b.requests) * 100) : 0;
  const missRate = b.requests > 0 ? Math.round((b.notFound / b.requests) * 100) : 0;

  return (
    <div className="border-t border-[var(--ink-4)] bg-[var(--ink-1)]/40 px-4 py-5">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="min-w-0 break-all font-mono text-[11px] text-[var(--fg-3)]">{b.userAgent}</span>
        {b.homepage && (
          <a
            href={b.homepage}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-xs text-[var(--amber-400)] underline-offset-2 hover:underline"
          >
            {b.homepage.replace(/^https?:\/\//, '')} ↗
          </a>
        )}
        {b.clientKind && (
          <span className="shrink-0 text-xs text-[var(--fg-4)]">{KIND_LABEL[b.clientKind] ?? b.clientKind}</span>
        )}
      </div>

      {b.verdict === 'servi' && (
        <div className="mb-5 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn)]">Le mur payant l&apos;a laissé passer.</span>{' '}
          {b.billableOk} appel{b.billableOk > 1 ? 's' : ''} sur un endpoint facturé, sans clé API. Cela peut être un
          règlement x402 accepté, ou un appel servi gratuitement : le journal des requêtes ne distingue pas les deux.
          À recouper avec les encaissements réels avant d&apos;y voir un revenu.
        </div>
      )}
      {b.verdict === 'perdu' && (
        <div className="mb-5 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn)]">Il cherche ce que nous ne servons pas.</span> {missRate} %
          de ses appels finissent en 404. Les chemins ci-dessous sont ce qu&apos;un annuaire attend de nous : les
          servir, c&apos;est gagner l&apos;inscription sans rien demander à personne.
        </div>
      )}
      {b.verdict === 'sonde' && (
        <div className="mb-5 rounded-lg border border-[var(--ink-5)] bg-[var(--ink-2)]/60 px-3 py-2 text-xs text-[var(--fg-3)]">
          <span className="font-semibold text-[var(--fg-2)]">Sonde, pas client.</span> {refusalRate} % de ses appels
          sont refusés et il revient quand même. Son volume gonfle le graphique du tunnel sans rien vouloir dire de la
          demande réelle.
        </div>
      )}
      {b.verdict === 'parti' && (
        <div className="mb-5 rounded-lg border border-[var(--ink-5)] bg-[var(--ink-2)]/60 px-3 py-2 text-xs text-[var(--fg-3)]">
          <span className="font-semibold text-[var(--fg-2)]">Il ne passe plus.</span> Rien depuis{' '}
          {relativeDays(b.daysSinceLastCall)}. Pour un annuaire, cesser de nous visiter est le premier signe d&apos;un
          déréférencement.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Requêtes" value={b.requests.toLocaleString('fr-CH')} hint={`${b.ok} servies`} />
        <Stat label="Introuvable" value={`${missRate} %`} hint={`${b.notFound} en 404`} />
        <Stat label="Refusé" value={`${refusalRate} %`} hint={`${b.paywall} en 402, ${b.badInput} en 400`} />
        <Stat label="Passé au travers" value={String(b.billableOk)} hint="appels facturés servis sans clé" />
        <Stat label="Machines" value={String(b.distinctIps)} hint="empreintes IP" />
        <Stat
          label="Dernier passage"
          value={relativeDays(b.daysSinceLastCall)}
          hint={b.firstSeenAt ? `depuis le ${b.firstSeenAt.slice(0, 10)}` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Passages" note="90 derniers jours">
          <Sparkbars days={b.days} />
        </Section>

        <Section title="Rythme de la journée" note="heures UTC">
          <HoursStrip hours={b.hours} />
        </Section>

        <Section title="Ce qu'il demande">
          {b.endpoints.length === 0 ? (
            <Empty>Aucun chemin enregistré.</Empty>
          ) : (
            b.endpoints.slice(0, 10).map((e) => (
              <Bar key={e.path} label={e.path} value={e.count} max={b.endpoints[0].count} />
            ))
          )}
        </Section>

        <Section title="Ce qu'il ne trouve pas" note={b.notFound > 0 ? `${b.notFound} en 404` : undefined}>
          {b.notFoundPaths.length === 0 ? (
            <Empty>Il trouve tout ce qu&apos;il demande.</Empty>
          ) : (
            b.notFoundPaths.map((e) => (
              <Bar key={e.path} label={e.path} value={e.count} max={b.notFoundPaths[0].count} tone="sky" />
            ))
          )}
        </Section>
      </div>
    </div>
  );
}
