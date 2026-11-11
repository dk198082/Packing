import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('PACKED appears on board cards, tables for both teams, and timestamped details', () => {
  const card = read('components/board/order-card.tsx');
  const table = read('components/board/order-table.tsx');
  const drawer = read('components/board/order-drawer.tsx');
  assert.match(card, /order\.packedAt &&/);
  assert.match(card, /PACKED/);
  assert.match(table, /const showPackStatus = true/);
  assert.match(table, /o\.packedAt \? 'PACKED'/);
  assert.match(drawer, /<PackedStatusEditor/);
  const editor = read('components/board/packed-status-editor.tsx');
  assert.match(editor, /data-testid="packed-detail"/);
  assert.match(editor, /dateTime=\{packedAt\}/);
  assert.match(editor, /new Date\(packedAt\)\.toLocaleString/);
});

test('Read users can correct or clear packed time, with confirmation and no Start Pack changes', () => {
  const editor = read('components/board/packed-status-editor.tsx');
  const drawer = read('components/board/order-drawer.tsx');
  assert.match(drawer, /canOperate=\{canOperatePackStatus\}/);
  assert.match(drawer, /packedAt=\{order\.packedAt\}/);
  assert.match(editor, /canOperate && !editing/);
  assert.match(editor, /data-testid="input-packed-datetime"/);
  assert.match(editor, /data-testid="button-edit-packed"/);
  assert.match(editor, /data-testid="button-clear-packed"/);
  assert.match(editor, /new Date\(draft\)\.toISOString\(\)/);
  assert.match(editor, /AlertDialogCancel disabled=\{busy\}/);
  assert.match(editor, /event\.preventDefault\(\); void save\(null\)/);
  assert.match(editor, /Start Pack date\/time will not change/);
  assert.match(editor, /PACKED change could not be saved/);
  const store = read('store/use-orders.ts');
  assert.match(store, /editOrderPacked\(orderId, \{ packedAt \}\)/);
  assert.match(store, /packedAt: status\.packedAt/);
});

test('Read and Read/Write users can start and finish; timestamp editing remains editor-only', () => {
  const drawer = read('components/board/order-drawer.tsx');
  assert.match(drawer, /order\.team !== 'SYSTEM'/);
  assert.match(drawer, /canOperatePackStatus && !order\.packedAt && !packStartedLabel/);
  assert.match(drawer, /canOperatePackStatus && !order\.packedAt && !isEditingPackStart/);
  assert.match(drawer, /!canOperatePackStatus \|\| fields\.packStartedAt/);
  assert.match(drawer, /if \(!canEditPackStatus \|\| !fields\.packStartedAt\) return/);
  assert.match(drawer, /data-testid="button-finish-pack"/);
  assert.match(drawer, /onFinishPack\(order\.id, 'manual'\)/);
  assert.match(drawer, /if \(result\.ok\)[\s\S]*order\.team === 'PARTS'[\s\S]*onFinishPack\(order\.id, 'label'\)/);
  assert.match(drawer, /Retry PACKED/);
  assert.match(drawer, /you do not need to reprint/);
  const store = read('store/use-orders.ts');
  assert.match(store, /if \(!canOperatePackStatus\) throw/);
  assert.match(read('pages/dashboard.tsx'), /canOperatePackStatus = user\.role === 'editor' \|\| user\.role === 'viewer'/);
  assert.match(store, /packedAt: status\.packedAt/);
  assert.match(store, /ORDER_REFRESH_INTERVAL_MS = 30_000/);
  assert.match(store, /revision === statusRevision\.current/);
});
