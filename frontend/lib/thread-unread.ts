import type { Message } from '@/lib/crm/types';

/**
 * Inbox-style unread test: a thread is unread when it has an inbound message
 * newer than last_read_at. Lives in a plain (non-'use client') module so it can
 * be called from Server Components — a function exported by a 'use client' module
 * becomes a client reference and throws if invoked during server render.
 */
export function threadIsUnread(messages: Message[], lastReadAt?: string | null): boolean {
  const lastRead = lastReadAt ? lastReadAt.replace(' ', 'T') : '';
  return messages.some((m) => m.direction === 'in' && (m.msg_date ?? '') > lastRead);
}
