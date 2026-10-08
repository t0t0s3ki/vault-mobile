import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftPath, isNewDraft, setSeed, takeSeed, withFront } from '../src/core/drafts.ts';

const F = '00_Cockpit/thinking/second-desk';
const day = new Date(2026, 9, 8, 9, 30);

test('draftPath: today, then the first free number', () => {
  assert.equal(draftPath(F, () => false, day), `${F}/20261008_無題.md`);
  const taken = new Set([`${F}/20261008_無題.md`, `${F}/20261008_無題2.md`]);
  assert.equal(draftPath(F, (p) => taken.has(p), day), `${F}/20261008_無題3.md`);
});

test('isNewDraft: only the 無題 names directly in the folder', () => {
  assert.ok(isNewDraft(F, `${F}/20261008_無題.md`));
  assert.ok(isNewDraft(F, `${F}/20261008_無題12.md`));
  assert.ok(!isNewDraft(F, `${F}/sub/20261008_無題.md`));
  assert.ok(!isNewDraft(F, `${F}/20261008_野村.md`));
  assert.ok(!isNewDraft(F, `${F}/../jobs/20261008_無題.md`));
  assert.ok(!isNewDraft(F, `01_Inbox/_uniquenote/20261008_無題.md`));
});

test('withFront: adds the desk frontmatter once', () => {
  const once = withFront('本文\n', day);
  assert.equal(once, '---\ntype: note\ntags: [second-desk]\nstatus: seed\ncreated: 2026-10-08\nupdated: 2026-10-08\nsource: "スマホで書いた原稿"\n---\n本文\n');
  assert.equal(withFront(once, day), once);
});

test('seed is taken once', () => {
  setSeed('書きかけ');
  assert.equal(takeSeed(), '書きかけ');
  assert.equal(takeSeed(), '');
});
