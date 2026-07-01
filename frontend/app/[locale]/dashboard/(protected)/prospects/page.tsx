import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { ProspectsWorkspace, type Prospect } from '@/components/dashboard/prospects-workspace';
import type { CrmMessage } from '@/components/dashboard/crm-workspace';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

interface ProspectApiRow {
  id: string;
  company: string;
  segment: string | null;
  website: string | null;
  country: string | null;
  what_they_do: string | null;
  fit_reason: string | null;
  buying_signal: string | null;
  signal_source_url: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  email_source_url: string | null;
  personalization_hook: string | null;
  confidence: string | null;
  status: string;
  mail_subject_en: string | null;
  mail_body_en: string | null;
  mail_subject_fr: string | null;
  mail_body_fr: string | null;
  recommended_lang: string | null;
  source: string | null;
}
interface MessageRow extends CrmMessage {
  customer_email: string;
}

export default async function ProspectsPage() {
  let rows: ProspectApiRow[] = [];
  let messageRows: MessageRow[] = [];
  let reachable = false;
  const customerEmails = new Set<string>();

  if (ADMIN_SECRET) {
    const h = { headers: { 'X-Admin-Secret': ADMIN_SECRET }, cache: 'no-store' as const };
    const [p, m, k] = await Promise.all([
      fetch(`${API_URL}/v1/admin/prospects`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${API_URL}/v1/admin/email-messages`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${API_URL}/v1/admin/keys`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (p) {
      reachable = true;
      rows = (p.prospects ?? []) as ProspectApiRow[];
    }
    messageRows = (m?.messages ?? []) as MessageRow[];
    // A prospect "became a client" when its contact email now has an API key.
    for (const row of (k?.keys ?? []) as Array<{ email?: string }>) {
      const e = (row.email ?? '').toLowerCase().trim();
      if (e.includes('@') && !e.endsWith('@example.com') && !e.endsWith('@ibanforge.com')) customerEmails.add(e);
    }
  }

  if (!reachable) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-8 text-center">
        <p className="font-medium text-zinc-300">Prospects indisponibles</p>
        <p className="mt-1 text-sm text-zinc-500">ADMIN_SECRET non configuré, ou API injoignable.</p>
      </div>
    );
  }

  // Email thread per address — a prospect we email lands here by contact_email,
  // so "contacted / replied" derive exactly like for customers.
  const threadsByEmail = new Map<string, CrmMessage[]>();
  for (const m of messageRows) {
    const key = m.customer_email.toLowerCase();
    const arr = threadsByEmail.get(key);
    if (arr) arr.push(m);
    else threadsByEmail.set(key, [m]);
  }

  const prospects: Prospect[] = rows
    .filter((r) => r.status !== 'rejete')
    .map((r) => {
      const messages = r.contact_email ? threadsByEmail.get(r.contact_email.toLowerCase()) ?? [] : [];
      const contacted = messages.some((x) => x.direction === 'out');
      const replied = messages.length > 0 && messages[messages.length - 1].direction === 'in';
      const lastMsgDate = messages.length ? messages[messages.length - 1].msg_date : null;
      return {
        ...r,
        messages,
        contacted,
        replied,
        lastTouch: lastMsgDate ? lastMsgDate.slice(0, 10) : null,
        becameClient: !!(r.contact_email && customerEmails.has(r.contact_email.toLowerCase())),
      };
    });

  const kpiMailer = prospects.filter((p) => p.status === 'a_mailer' && !p.contacted).length;
  const kpiEnrich = prospects.filter((p) => p.status === 'a_enrichir').length;
  const kpiContacted = prospects.filter((p) => p.contacted && !p.replied).length;
  const kpiReplied = prospects.filter((p) => p.replied).length;
  const active = prospects.filter((p) => p.status !== 'archive').length;
  const converted = prospects.filter((p) => p.becameClient);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Prospects — campagne</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {active} prospects qualifiés · mail personnalisé prêt · relis puis envoie depuis claude-alain@ibanforge.com
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCardV2 title="À mailer" value={String(kpiMailer)} accentColor="#22c55e" hint="Email vérifié + mail rédigé. Prêts à relire et envoyer." />
        <StatCardV2 title="À enrichir" value={String(kpiEnrich)} accentColor="#f59e0b" hint="Bon prospect mais pas d'email sûr trouvé — à compléter avant d'écrire. On ne devine jamais une adresse (un email faux = rebond = spam)." />
        <StatCardV2 title="Contactés" value={String(kpiContacted)} accentColor="#3b82f6" hint="Mail envoyé, en attente de réponse." />
        <StatCardV2 title="Réponses" value={String(kpiReplied)} accentColor="#a855f7" hint="Ils ont répondu — à toi de jouer." />
      </div>

      {converted.length > 0 && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200">
          🎉 <span className="font-semibold">
            {converted.length} prospect{converted.length > 1 ? 's' : ''} devenu{converted.length > 1 ? 's' : ''} client{converted.length > 1 ? 's' : ''}
          </span>{' '}
          : {converted.map((p) => p.company).join(', ')}
        </div>
      )}

      <ProspectsWorkspace prospects={prospects} />

      <p className="text-[11px] text-zinc-600">
        Prospection 1:1 · texte brut, opt-out inclus, bas volume depuis un domaine authentifié (SPF/DKIM/DMARC) — conçu pour ne pas tomber en spam et rester conforme (LCD/RGPD).
      </p>
    </div>
  );
}
