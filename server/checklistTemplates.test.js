import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'prodmesh-tpl-'));
process.env.PRODMESH_DATA_DIR = DIR;
const tpl = await import('./checklistTemplates.js');
const { validateTemplateItems } = await import('./validate.js');

test('seeds defaults on first load and persists them', () => {
  assert.ok(tpl.templateFor('500001').length >= 4); // Sunday seed
  const onDisk = JSON.parse(readFileSync(join(DIR, 'checklists.json'), 'utf8'));
  assert.ok(onDisk.templates['*'].length > 0);
});

test('setTemplate assigns slug ids, preserves given ids, dedupes', () => {
  tpl.setTemplate('999', [
    { label: 'Turn on the FOH console' },
    { id: 'packs', label: 'Charge packs' },
    { label: 'Turn on the FOH console' }, // dup label → deduped id
    { label: 'Go live', action: { type: 'mode', mode: 'sunday' } },
  ]);
  const items = tpl.templateFor('999');
  assert.deepEqual(
    items.map((i) => i.id),
    ['turn-on-the-foh-console', 'packs', 'turn-on-the-foh-console-2', 'go-live'],
  );
  assert.deepEqual(items[3].action, { type: 'mode', mode: 'sunday' });
  assert.equal(items[0].action, undefined);
});

test('removeTemplate falls back to *, removing * falls back to []', () => {
  tpl.setTemplate('888', [{ label: 'Something' }]);
  tpl.removeTemplate('888');
  assert.deepEqual(tpl.templateFor('888'), tpl.templateFor('*'));
  const star = tpl.getTemplates()['*'];
  tpl.removeTemplate('*');
  assert.deepEqual(tpl.templateFor('888'), []);
  tpl.setTemplate('*', star); // restore for other tests
});

test('validation rejects bad shapes', () => {
  assert.throws(() => validateTemplateItems('nope'), /array/);
  assert.throws(() => validateTemplateItems([{ label: '' }]), /label/);
  assert.throws(() => validateTemplateItems([{ label: 'ok', id: 'bad id!' }]), /ids/);
  assert.throws(() => validateTemplateItems([{ label: 'ok', action: { type: 'nope' } }]), /action/);
  assert.throws(() => validateTemplateItems([{ label: 'ok', action: { type: 'mode' } }]), /action/);
  assert.equal(validateTemplateItems([{ label: 'ok' }]).length, 1);
});
