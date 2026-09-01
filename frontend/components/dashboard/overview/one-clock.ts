import { cache } from 'react';
import type { BuildInput } from '@/lib/crm/build-contacts';
import { crmSnapshot, type CrmSnapshot } from '@/lib/crm/snapshot';

/**
 * One reading of the contact base, and one clock, for the whole page.
 *
 * Four of the five sections need the CRM snapshot, and each one is now its own
 * async component under its own <Suspense> — so without this they would each
 * call `crmSnapshot(crm, new Date())`, four times, against four instants that
 * are further apart than they used to be, not closer, precisely because the
 * sections resolve independently. snapshot.ts states the rule in its own
 * docstring: one clock for the whole page, or two counts of the same thing can
 * straddle midnight and disagree.
 *
 * `cache` from React memoises per render pass on argument identity. Every
 * section awaits the same `fetchCrmData()` promise, so `crm` is the same object,
 * and `nowIso` is the page's single timestamp — so buildContacts walks the base
 * ONCE per render instead of four times, on the page the audit already measured
 * as the slowest of the five tabs.
 */
export const snapshotOnce = cache(
  (crm: BuildInput, nowIso: string): CrmSnapshot => crmSnapshot(crm, new Date(nowIso)),
);

/**
 * The contact ids the CRM actually emits.
 *
 * A "write" link carries an address to /dashboard/contacts, which opens the
 * matching thread — and opens NOTHING, silently, when the address is not in the
 * list. buildContacts drops a key that never called, carries no mail thread and
 * signed up more than NEW_SIGNUP_DAYS ago, which is the literal definition of
 * the queue's largest bucket. So the button is only offered for an address the
 * receiving page can actually land on.
 */
export const writableIds = cache((snap: CrmSnapshot): Set<string> => new Set(snap.contacts.map((c) => c.id)));
