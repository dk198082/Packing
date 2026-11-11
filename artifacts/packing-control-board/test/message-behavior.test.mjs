import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isPendingIncoming, recipientAck, mergeMessage, isLegacy, errorText,
} from '../src/components/messages/message-utils.ts';

const message = {
  id: 'test-message', content: 'Check station.', authorId: 'sender', authorName: 'Sender',
  recipientId: 'recipient', recipientName: 'Recipient', createdAt: '2026-11-05T15:00:00Z',
  acknowledgments: [],
};
const acknowledgment = { userId: 'recipient', displayName: 'Recipient', acknowledgedAt: '2026-11-05T15:01:00Z' };

test('new directed messages alert only their selected recipient, never sender or unrelated users', () => {
  assert.equal(isPendingIncoming(message, 'recipient'), true);
  assert.equal(isPendingIncoming(message, 'sender'), false);
  assert.equal(isPendingIncoming(message, 'other-reader'), false);
  assert.equal(isPendingIncoming(message, 'other-editor'), false);
  assert.equal(isPendingIncoming({ ...message, recipientId: null }, 'recipient'), false);
});

test('recipient OK removes New and retains an exact named/timestamped receipt for sender', () => {
  const done = { ...message, acknowledgments: [acknowledgment] };
  assert.equal(isPendingIncoming(done, 'recipient'), false);
  assert.deepEqual(recipientAck(done), acknowledgment);
  assert.equal(isPendingIncoming({ ...done, acknowledgments: [] }, 'recipient'), true, 'un-check must alert again');
  const wrongAck = { ...acknowledgment, userId: 'sender' };
  assert.equal(recipientAck({ ...message, acknowledgments: [wrongAck] }), null);
  assert.equal(isPendingIncoming({ ...message, acknowledgments: [wrongAck] }, 'recipient'), true);
});

test('legacy messages never alert and are recognized independently of receipt state', () => {
  const legacy = { ...message, recipientId: null, recipientName: null };
  assert.equal(isLegacy(legacy), true);
  assert.equal(isLegacy(message), false);
  assert.equal(isPendingIncoming(legacy, 'sender'), false);
  assert.equal(recipientAck(legacy), null);
});

test('acknowledgment cache replacement is immutable and never duplicates or loses sent messages', () => {
  const old = { messages: [message] };
  const done = { ...message, acknowledgments: [acknowledgment] };
  const updated = mergeMessage(old, done);
  assert.deepEqual(updated.messages, [done]);
  assert.deepEqual(old.messages[0].acknowledgments, []);
  assert.deepEqual(mergeMessage(updated, done).messages, [done]);
  assert.deepEqual(mergeMessage(undefined, message), old);
  assert.equal(mergeMessage(old, { ...message, id: 'second' }).messages.length, 2);
});

test('failed sends/OKs can display explicit server errors rather than a false success', () => {
  assert.equal(errorText({ status: 403, data: { message: 'Recipient access revoked.' } }, 'Failed'), 'Recipient access revoked.');
  assert.equal(errorText({ status: 403 }, 'Failed'), 'You do not have permission for this action.');
  assert.equal(errorText(new Error('network failed'), 'Draft retained'), 'Draft retained');
});
