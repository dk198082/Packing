import type { PackingMessage, PackingMessagesResponse } from '@workspace/api-client-react';

export const MAX_LEN = 200;
export const LATER_MS = 2 * 60_000;

const stampFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function formatStamp(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : stampFormat.format(d);
}

export function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const e = error as { status?: number; data?: { error?: string; message?: string } };
    const detail = e.data?.error ?? e.data?.message;
    if (detail) return detail;
    if (e.status === 403) return 'You do not have permission for this action.';
  }
  return fallback;
}

export function mergeMessage(old: PackingMessagesResponse | undefined, msg: PackingMessage): PackingMessagesResponse {
  if (!old) return { messages: [msg] };
  const exists = old.messages.some(m => m.id === msg.id);
  return { ...old, messages: exists ? old.messages.map(m => (m.id === msg.id ? msg : m)) : [msg, ...old.messages] };
}

export function isLegacy(m: PackingMessage): boolean {
  return m.recipientId === null;
}

/** Incoming directed message to me that I have not yet OK'd. Never my own. */
export function isPendingIncoming(m: PackingMessage, oid: string): boolean {
  return m.recipientId === oid && m.authorId !== oid && !m.acknowledgments.some(a => a.userId === oid);
}

/** Recipient's acknowledgment for a directed message. */
export function recipientAck(m: PackingMessage) {
  return m.recipientId ? m.acknowledgments.find(a => a.userId === m.recipientId) ?? null : null;
}
