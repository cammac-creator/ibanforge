import { isAutomated } from '@/lib/crm/automated';
import type { Message } from '@/lib/crm/types';

/**
 * Inbox-style unread test: a thread is unread when it has an inbound message
 * from a person newer than last_read_at. Lives in a plain (non-'use client')
 * module so it can be called from Server Components — a function exported by a
 * 'use client' module becomes a client reference and throws if invoked during
 * server render.
 *
 * Automated inbound does not mark a thread unread. The list sorts unread rows
 * to the very top, ahead of the priority ladder, so a ticket robot arriving at
 * 3am would otherwise take the first slot of the working queue every morning:
 * the same defect automated.ts exists to fix, entering through the sort rather
 * than through the situation.
 */
export function threadIsUnread(messages: Message[], lastReadAt?: string | null): boolean {
  const lastRead = lastReadAt ? lastReadAt.replace(' ', 'T') : '';
  return messages.some(
    (m) => m.direction === 'in' && (m.msg_date ?? '') > lastRead && !isAutomated(m),
  );
}
