import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = p => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const center = read('components/messages/messages-center.tsx');
const item = read('components/messages/message-item.tsx');
const utils = read('components/messages/message-utils.ts');
const hook = read('components/messages/use-messages.ts');
const popup = read('components/messages/message-popup.tsx');
const composer = read('components/messages/message-composer.tsx');
const all = [center, item, utils, hook, popup, composer].join('\n');

test('static message board removed; Messages button replaces Search by label', () => {
  assert.ok(!existsSync(new URL('../src/components/messages/message-board.tsx', import.meta.url)));
  assert.doesNotMatch(read('pages/dashboard.tsx'), /MessageBoard/);
  const bar = read('components/board/filter-bar.tsx');
  assert.doesNotMatch(bar, /Search by:/);
  assert.match(bar, /<MessagesCenter \/>/);
  assert.match(bar, /id="order-search"/);
});

test('pending incoming derived from recipient and own ack, never own message', () => {
  assert.match(utils, /m\.recipientId === oid && m\.authorId !== oid && !m\.acknowledgments\.some\(a => a\.userId === oid\)/);
  assert.doesNotMatch(all, /localStorage|sessionStorage/);
});

test('popup suppressed while window open; Later resurfaces', () => {
  assert.match(center, /!open && !snoozed \? oldestPending : null/);
  assert.match(utils, /LATER_MS = 2 \* 60_000/);
  assert.match(popup, /text-red-400/);
});

test('queries scoped per account and keep polling', () => {
  assert.match(hook, /\[\.\.\.getGetPackingMessagesQueryKey\(\), entraOid\]/);
  assert.match(hook, /\[\.\.\.getGetMessageRecipientsQueryKey\(\), entraOid\]/);
  assert.match(hook, /refetchInterval: 10_000/);
  assert.match(hook, /enabled: isEditor && windowOpen/);
  assert.match(hook, /removeQueries/);
});

test('editor-only send with recipient; 200 limit; empty recipients explained', () => {
  assert.match(center, /isEditor && <MessageComposer/);
  assert.match(utils, /MAX_LEN = 200/);
  assert.match(composer, /Users appear here after they sign in/);
  assert.match(hook, /data: \{ content, recipientId \}/);
});

test('legacy messages author-only, labelled, no popup; reset/remove confirmed', () => {
  assert.match(center, /!isLegacy\(m\) \|\| m\.authorId === entraOid/);
  assert.match(item, /Previous board message/);
  assert.match(item, /isEditor && done/);
  assert.ok(center.includes('data-testid="button-confirm-message-action"'));
  assert.doesNotMatch(all, /archive|history|needs[\s_-]*my[\s_-]*ok/i);
});
