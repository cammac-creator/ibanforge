import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '../messages/fr.json';
import { ApiKeyDialogProvider } from './api-key-dialog';

/**
 * Relecture de la PR 617 (C24) : la branche du dialogue qui dit, dans la langue
 * du visiteur, que sa clé ne lui a pas été envoyée par e-mail (`key_mailed`
 * vaut `false`). Sans elle, l'écran laisserait croire qu'une copie l'attend dans
 * sa boîte, alors qu'il est la seule.
 *
 * Même hôte léger que `first-call-panel.test.ts` : les crochets de React sont
 * remplacés par des cases simples, le vrai dialogue est ouvert et son vrai
 * formulaire envoyé (réseau simulé), puis le rendu est relu.
 */
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (value: unknown) => {
        hooks.slots[index] = value;
      },
    ];
  },
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}));

/** Une clé de `messages/fr.json`, chemin pointé compris (`verify.submit`). */
function message(namespace: string, key: string): string {
  let node: unknown = (fr as Record<string, unknown>)[namespace];
  for (const part of key.split('.')) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }
  return typeof node === 'string' ? node : key;
}
/** `t(key)` and `t.rich(key)`, the message as written (rich tags left as text). */
function translator(namespace: string) {
  return Object.assign((key: string) => message(namespace, key), {
    rich: (key: string) => message(namespace, key),
  });
}
vi.mock('next-intl', () => ({
  useTranslations: translator,
  useLocale: () => 'fr',
}));

function render(): ReactElement<{ value: { open: () => void } }> {
  hooks.cursor = 0;
  return ApiKeyDialogProvider({ children: null }) as ReactElement<{ value: { open: () => void } }>;
}
function elements(node: ReactNode): Record<string, unknown>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [child.props, ...elements(child.props.children)];
  });
}
function texte(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child) ? texte(child.props.children) : String(child),
    )
    .join(' ');
}

/** Ouvre le dialogue, envoie le formulaire sans adresse, et rend l'écran de la clé. */
async function issueKey(answer: Record<string, unknown>): Promise<string> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answer), { status: 201 })));
  render().props.value.open();
  const form = elements(render()).find((p) => typeof p.onSubmit === 'function');
  expect(form, 'le formulaire de la clé').toBeDefined();
  (form!.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
  await vi.waitFor(() => expect(texte(render())).toContain(fr.apiKeyDialog.successTitle));
  return texte(render());
}

const ANSWER = {
  api_key: 'ifk_' + '1'.repeat(64),
  key_prefix: 'ifk_1111',
  tier: 'anonymous',
  monthly_limit: 25,
  claim_url: 'https://ibanforge.com/fr/claim',
  message: 'Key created.',
};

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  // `open()` retient l'élément qui avait le focus : aucun, hors navigateur.
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('HTMLElement', class {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('le dialogue de clé, quand la clé n’est pas partie par e-mail', () => {
  it('le dit au visiteur, dans sa langue, quand key_mailed vaut false', async () => {
    const ecran = await issueKey({
      ...ANSWER,
      key_mailed: false,
      mail_notice: 'Key e-mail delivery is paused.',
    });
    expect(ecran).toContain(fr.apiKeyDialog.successWarn);
    expect(ecran).toContain(fr.apiKeyDialog.mailNotSent);
    // La phrase anglaise de l'API ne remplace pas la nôtre.
    expect(ecran).not.toContain('Key e-mail delivery is paused.');
  });

  it('ne le dit pas quand la réponse ne porte pas le champ', async () => {
    const ecran = await issueKey(ANSWER);
    expect(ecran).toContain(fr.apiKeyDialog.successWarn);
    expect(ecran).not.toContain(fr.apiKeyDialog.mailNotSent);
  });
});
