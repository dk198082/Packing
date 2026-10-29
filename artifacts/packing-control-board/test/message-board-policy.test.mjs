import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(
  new URL('../src/components/messages/message-board.tsx', import.meta.url),
  'utf8',
);

// Guard against older task branches restoring the rejected personal OK filter.
test('message board does not restore personal Needs My OK tracking', () => {
  assert.doesNotMatch(source, /needs[\s_-]*my[\s_-]*ok|showNeedsMyOk|visibleMessages/i);
  assert.match(source, /messages\.map\(/);
});

test('individual OKs remain without archive or history controls', () => {
  assert.match(source, /useAcknowledgePackingMessage/);
  assert.ok(source.includes('data-testid={`button-ok-${m.id}`}'));
  assert.match(source, /m\.acknowledgments\.map/);
  assert.match(source, /formatStamp\(a\.acknowledgedAt\)/);
  assert.doesNotMatch(source, /archive|history/i);
});

test('Read/Write users may OK their own messages', () => {
  assert.match(source, /const cannotAckOwn = m\.authorId === entraOid && !isEditor/);
  assert.match(source, /disabled=\{cannotAckOwn \|\| acked \|\| pending\}/);
});

test('only messages without any acknowledgments show a red New badge', () => {
  assert.match(source, /const isNew = m\.acknowledgments\.length === 0/);
  assert.match(source, /isNew &&/);
  assert.match(source, /bg-red-600/);
  assert.ok(source.includes('data-testid={`badge-new-${m.id}`}'));
  assert.match(source, /New!/);
  assert.match(source, /refetchInterval: 15_000/);
});

test('new text is red, completed buttons say DONE, and large message text comes before metadata', () => {
  assert.ok(source.includes("isNew ? 'text-red-400' : 'text-foreground'"));
  assert.ok(source.includes("acked ? 'DONE' : 'OK'"));
  assert.doesNotMatch(source, /OK[’']d/i);
  assert.match(source, /text-base font-semibold leading-6/);
  assert.ok(source.indexOf('data-testid={`text-content-${m.id}`}') < source.indexOf('data-testid={`text-author-${m.id}`}'));
  assert.match(source, /truncate text-sm font-semibold text-red-400/);
});

test('collapsed board shows only unacknowledged messages and can be expanded', () => {
  assert.match(source, /const newMessages = messages\.filter\(message => message\.acknowledgments\.length === 0\)/);
  assert.ok(source.includes('data-testid="button-toggle-message-board"'));
  assert.ok(source.includes('aria-expanded={!collapsed}'));
  assert.ok(source.includes('data-testid="list-new-messages-collapsed"'));
  assert.match(source, /newMessages\.map\(message =>/);
  assert.match(source, /No new messages/);
});

test('expanded messages are a separate right-hand column, not inside the composer', () => {
  assert.match(source, /w-\[34%\] min-w-\[220px\] flex-col/);
  assert.match(source, /<\/div>}\s*<\/div>\s*<div\s+id="message-board-content"/);
  assert.match(source, /className=\{collapsed \? 'hidden' : 'flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border pl-2\.5'\}/);
  assert.ok(source.includes('data-testid="message-list-column"'));
});

test('message composer has no placeholder and an empty board says only No Messages', () => {
  assert.doesNotMatch(source, /Post a note for both teams|Post the first note for the shift|No messages yet/i);
  assert.match(source, />\s*No Messages\s*</);
});

test('message length is capped at 200 characters', () => {
  assert.match(source, /const MAX_LEN = 200/);
  assert.match(source, /maxLength=\{MAX_LEN\}/);
});
