import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockRemote } from '../src/remote/mock.ts';
import { MemoryStore } from '../src/core/storage.ts';
import { Vault, writable } from '../src/core/vault.ts';
import { splitFrontmatter, parseLink } from '../src/core/note.ts';
import { demoVault } from '../src/fixtures/demo.ts';

async function setup() {
  const remote = new MockRemote(demoVault);
  const store = new MemoryStore();
  const vault = new Vault(remote, store);
  await vault.sync();
  return { remote, store, vault };
}

test('隠しフォルダは取り込まない', async () => {
  const { vault } = await setup();
  assert.ok(!vault.note('.obsidian/workspace.json'));
  assert.ok(!vault.entries.has('.obsidian/workspace.json'));
});

test('2回目の同期は変わったファイルだけ取る', async () => {
  const { remote, vault } = await setup();
  assert.equal((await vault.sync()).downloaded, 0);
  remote.externalEdit('04_Think/読み心地.md', '# 変更');
  assert.equal((await vault.sync()).downloaded, 1);
});

test('キャッシュから復元できる（オフラインで開ける）', async () => {
  const { remote, store } = await setup();
  const again = new Vault(remote, store);
  await again.loadCache();
  assert.ok(again.note('04_Think/余白の設計.md'));
  assert.equal(again.search('余白')[0].meta.path, '04_Think/余白の設計.md');
});

test('リンク解決：同名ノートはパス指定・同じフォルダを優先、別名でも引ける', async () => {
  const { vault } = await setup();
  assert.equal(vault.resolve('1002_読書会/README'), '02_Projects/1002_読書会/README.md');
  assert.equal(vault.resolve('README', '02_Projects/1002_読書会/議事録_20261001.md'), '02_Projects/1002_読書会/README.md');
  assert.equal(vault.resolve('読みやすさ'), '04_Think/読み心地.md');
  assert.equal(vault.resolve('存在しないノート'), undefined);
  assert.deepEqual(parseLink('余白の設計#行間|ここ'), { target: '余白の設計', anchor: '行間', label: 'ここ' });
  assert.deepEqual(parseLink('議事録_20261001#^homework'), { target: '議事録_20261001', anchor: 'homework', label: '' });
});

test('埋め込み画像をファイル名で解決する', async () => {
  const { vault } = await setup();
  const e = vault.resolveFile('表紙.svg', '02_Projects/1002_読書会/README.md');
  assert.equal(e?.path, '05_Knowledge/画像/表紙.svg');
  const blob = await vault.image(e!);
  assert.equal(blob.type, 'image/svg+xml');
});

test('被リンク', async () => {
  const { vault } = await setup();
  const from = vault.backlinks('04_Think/余白の設計.md').map((m) => m.path).sort();
  assert.deepEqual(from, ['00_Cockpit/thinking/読書会_準備_20261005.md', '02_Projects/1001_試作アプリ/README.md', '02_Projects/1002_読書会/議事録_20261001.md', '04_Think/読み心地.md']);
});

test('検索：タイトル・別名を本文より上に出す', async () => {
  const { vault } = await setup();
  assert.equal(vault.search('読みやすさ')[0].meta.path, '04_Think/読み心地.md');
  const hits = vault.search('余白').map((h) => h.meta.path);
  assert.equal(hits[0], '04_Think/余白の設計.md');
  assert.ok(vault.search('スクロールの位置')[0].snippet.includes('スクロール'));
});

test('専用の手順があるファイルは編集対象にしない', () => {
  assert.equal(writable('00_Cockpit/Tasks.md'), false);
  assert.equal(writable('00_Cockpit/Tasks_副業.md'), false);
  assert.equal(writable('00_Cockpit/state/events/x.md'), false);
  assert.equal(writable('04_Think/読み心地.md'), true);
});

test('壊れたYAMLは本文を読めて、エラーとして知らせる', () => {
  const r = splitFrontmatter(demoVault['04_Think/壊れたYAML.md'] as string);
  assert.ok(r.error);
  assert.ok(r.body.includes('本文は読めて'));
});

test('最近更新とフォルダ', async () => {
  // Keep ordering independent of the demo's dates relative to today.
  const remote = new MockRemote({
    '02_Projects/1001_試作アプリ/README.md': '---\nupdated: 2026-10-03\n---\n# 試作',
    '02_Projects/1002_読書会/README.md': '---\nupdated: 2026-10-01\n---\n# 読書会',
    '01_Inbox/_uniquenote/202610020812.md': '新しいメモ',
    '01_Inbox/_uniquenote/202610010812.md': '古いメモ',
    '01_Inbox/Clips/20261004.md': '---\nupdated: 2026-10-04\n---\n# クリップ',
  });
  const vault = new Vault(remote, new MemoryStore());
  await vault.sync();
  assert.deepEqual(vault.recent(5, ['01_Inbox/_uniquenote', '01_Inbox/Clips']).map((m) => m.path), [
    '02_Projects/1001_試作アプリ/README.md',
    '02_Projects/1002_読書会/README.md',
  ]);
  assert.equal(vault.recent(1)[0].path, '01_Inbox/Clips/20261004.md');
  assert.equal(vault.latestIn('01_Inbox/_uniquenote')[0].path, '01_Inbox/_uniquenote/202610020812.md');
  assert.deepEqual(
    vault.folder('02_Projects').folders.map((f) => f.name),
    ['1001_試作アプリ', '1002_読書会'],
  );
});

test('ドットの段やバックスラッシュを含むパスには書かない', async () => {
  const { safePath } = await import('../src/core/vault.ts');
  for (const bad of ['01_Inbox/_uniquenote/../../00_Cockpit/jobs/queued/x.md', './a.md', 'a//b.md', '/a.md', 'a' + String.fromCharCode(92) + 'b.md', '..'])
    assert.equal(safePath(bad), false, bad);
  assert.equal(writable('01_Inbox/_uniquenote/../../04_Think/x.md'), false);
  assert.equal(safePath('01_Inbox/_uniquenote/202610040812.md'), true);
  const { GitHubRemote } = await import('../src/remote/github.ts');
  const r = new GitHubRemote({ owner: 'o', repo: 'r', branch: 'main' }, async () => 't', (async () => new Response('{}')) as unknown as typeof fetch, 'https://api.test');
  await assert.rejects(r.put('a/../../x.md', 'x', '', 'm'), /書けません/);
});

test('HTML：棚と検索に出し、開いたら端末に残す（2回目は取りに行かない）', async () => {
  const { isViewable } = await import('../src/core/vault.ts');
  const { remote, vault } = await setup();
  const f = vault.folder('02_Projects/1002_読書会');
  assert.deepEqual(f.files.map((e) => e.path), ['02_Projects/1002_読書会/読書会_振り返り.html']);
  assert.equal(vault.searchFiles('振り返り')[0]?.path, '02_Projects/1002_読書会/読書会_振り返り.html');
  assert.equal(vault.folder('02_Projects').folders.find((x) => x.name === '1002_読書会')!.count >= 3, true);
  const entry = vault.entries.get('02_Projects/1002_読書会/読書会_振り返り.html')!;
  assert.ok((await vault.fileText(entry)).includes('<title>'));
  remote.texts = async () => {
    throw new Error('取りに行ってはいけない');
  };
  assert.ok((await vault.fileText(entry)).includes('<title>'));
  assert.equal(isViewable('.claude/tmp.html'), false);
  assert.equal(isViewable('a/b.md'), false);
});
