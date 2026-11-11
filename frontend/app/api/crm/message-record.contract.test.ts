import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as send } from './send/route';
import { POST as saveDraft } from './draft-message/route';
import { SENDING_ACCOUNT } from '@/lib/crm/sending-account';

/**
 * Le contrat entre le site et `POST /v1/admin/email-messages` sous la clé du
 * site (`SITE_ADMIN_TOKEN`), depuis le journal des entrées d'administration (PR
 * 611, `src/routes/api-keys.ts`) : l'API refuse à cette clé, et en bloc, une
 * ligne d'origine `claude` (`origin_not_allowed`, un envoi automatique) et toute
 * réécriture d'un message déjà enregistré, sauf un brouillon réenregistré en
 * brouillon (`rewrite_not_allowed`). Un 403 ici ne se voit pas à l'écran :
 * l'envoi est consigné « au mieux », et le fil perd sa ligne sans rien dire.
 *
 * Ce test lit le corps réellement posté par les deux routes du site qui écrivent
 * un message, et tient les deux moitiés du contrat :
 *
 *  - l'enregistrement d'un envoi porte l'origine du tableau de bord, jamais celle
 *    de l'agent, sous un identifiant neuf qui n'est pas celui d'un brouillon ;
 *  - un brouillon garde `direction: 'draft'` sur un identifiant de brouillon,
 *    sans origine d'agent.
 *
 * Fixtures sur des domaines réservés : ce dépôt est public.
 */

vi.mock('@/lib/auth', () => ({ isAuthenticated: async () => true }));

interface Posted {
  url: string;
  method: string;
  body: { messages?: Array<Record<string, unknown>> };
}

let posted: Posted[] = [];

beforeEach(() => {
  posted = [];
  vi.stubEnv('TABORNIO_CRM_URL', 'https://upstream.example.com');
  vi.stubEnv('CRM_DRAFT_SECRET', 'secret-fictif');
  vi.stubEnv('API_URL', 'https://api.example.com');
  vi.stubEnv('SITE_ADMIN_TOKEN', 'cle-du-site-fictive');
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    posted.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url.includes('/v1/admin/email-messages') && method === 'GET') {
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    }
    if (url.includes('/api/crm/send')) {
      return new Response(JSON.stringify({ sent: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ upserted: 1 }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://dashboard.example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Les lignes postées vers le registre des messages. */
function recorded(): Array<Record<string, unknown>> {
  return posted
    .filter((p) => p.url.includes('/v1/admin/email-messages') && p.method === 'POST')
    .flatMap((p) => p.body.messages ?? []);
}

/** The one mailbox the dashboard writes from (sending-account.ts). */
const ACCOUNT = SENDING_ACCOUNT;
const BODY =
  'Bonjour, je reviens vers vous au sujet de la validation des IBAN pour vos virements sortants. ' +
  'Dites-moi si un essai vous intéresse.';

describe('contrat des messages écrits par le site sous sa clé', () => {
  it('l’enregistrement d’un envoi porte l’origine du tableau de bord, jamais celle de l’agent', async () => {
    for (const intent of ['outbound', 'reply']) {
      posted = [];
      const res = await send(
        request('/api/crm/send', {
          account: ACCOUNT,
          to: 'acme@example.net',
          subject: 'Validation IBAN',
          body: BODY,
          intent,
        }),
      );
      expect(res.status, intent).toBe(200);
      const rows = recorded();
      expect(rows, intent).toHaveLength(1);
      const [row] = rows;
      expect(row.origin, intent).toBe('dashboard');
      expect(row.direction, intent).toBe('out');
      // Un identifiant neuf, jamais celui d'un brouillon : l'API refuserait à
      // la clé du site de réécrire un brouillon en envoi.
      expect(String(row.id), intent).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('un brouillon garde direction « draft » sur un identifiant de brouillon, sans origine d’agent', async () => {
    const first = await saveDraft(
      request('/api/crm/draft-message', {
        email: 'Acme@Example.net',
        subject: 'Suivi',
        body: BODY,
        account: ACCOUNT,
      }),
    );
    expect(first.status).toBe(200);
    const again = await saveDraft(
      request('/api/crm/draft-message', { email: 'acme@example.net', subject: 'Autre', body: 'x' }),
    );
    expect(again.status).toBe(200);
    const rows = recorded();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.direction).toBe('draft');
      expect(String(row.id)).toMatch(/^draft-[0-9a-f]{32}$/);
      expect(row.origin).not.toBe('claude');
    }
    // Réenregistré, le brouillon garde son identifiant : la seule réécriture
    // que l'API accepte de la clé du site.
    expect(rows[1].id).toBe(rows[0].id);
  });
});
