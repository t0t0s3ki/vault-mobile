import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubRemote } from '../src/remote/github.ts';
import { AuthError, ConflictError, RejectedError, TransportError } from '../src/remote/types.ts';
import { utf8ToBase64 } from '../src/core/text.ts';

type Call = { url: string; init: RequestInit };
function fake(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const http = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  const remote = new GitHubRemote({ owner: 'o', repo: 'r', branch: 'main' }, async () => 'TOKEN', http, 'https://api.test');
  return { remote, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('保存は基準SHAとbranchを付けてPUTし、本文はUTF-8のbase64', async () => {
  const { remote, calls } = fake(() => json({ content: { sha: 'new' } }));
  const r = await remote.put('04_Think/読み心地.md', '日本語', 'old', 'mobile: x');
  assert.equal(r.sha, 'new');
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.test/repos/o/r/contents/04_Think/' + encodeURIComponent('読み心地.md'));
  assert.equal(init.method, 'PUT');
  const body = JSON.parse(String(init.body));
  assert.deepEqual(body, { message: 'mobile: x', content: utf8ToBase64('日本語'), sha: 'old', branch: 'main' });
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer TOKEN');
});

test('409・422・404は競合、401は認証切れ、通信失敗と5xxは成功不明', async () => {
  for (const status of [409, 404])
    await assert.rejects(fake(() => json({}, status)).remote.put('a.md', 'x', 's', 'm'), ConflictError);
  await assert.rejects(fake(() => json({}, 401)).remote.put('a.md', 'x', 's', 'm'), AuthError);
  await assert.rejects(fake(() => json({}, 502)).remote.put('a.md', 'x', 's', 'm'), TransportError);
  await assert.rejects(
    fake(() => {
      throw new TypeError('Failed to fetch');
    }).remote.put('a.md', 'x', 's', 'm'),
    TransportError,
  );
});

test('本文は GraphQL で100件ずつまとめて取る', async () => {
  const shas = Array.from({ length: 150 }, (_, i) => i.toString(16).padStart(40, '0'));
  const { remote, calls } = fake((_url, init) => {
    const q = JSON.parse(String(init.body)).query as string;
    const n = (q.match(/object\(oid/g) || []).length;
    return json({ data: { repository: Object.fromEntries(Array.from({ length: n }, (_, k) => ['b' + k, { text: 't' + k, isBinary: false, isTruncated: false }])) } });
  });
  const out = await remote.texts(shas);
  assert.equal(calls.length, 2);
  assert.equal(out.size, 150);
});

test('ファイル取得：404は無し、base64を復号する', async () => {
  assert.equal(await fake(() => json({}, 404)).remote.file('a.md'), null);
  const f = await fake(() => json({ type: 'file', sha: 's1', encoding: 'base64', content: utf8ToBase64('本文') })).remote.file('a.md');
  assert.deepEqual(f, { sha: 's1', text: '本文' });
});

test('422は版の不一致だけ競合、それ以外と429は拒否', async () => {
  await assert.rejects(fake(() => json({ message: 'a.md does not match abc' }, 422)).remote.put('a.md', 'x', 's', 'm'), ConflictError);
  await assert.rejects(fake(() => json({ message: 'Invalid request' }, 422)).remote.put('a.md', 'x', 's', 'm'), RejectedError);
  await assert.rejects(fake(() => json({}, 429)).remote.put('a.md', 'x', 's', 'm'), RejectedError);
});

test('BOM付きファイルを REST で読んでも BOM を落とさない', async () => {
  const f = await fake(() => json({ type: 'file', sha: 's', encoding: 'base64', content: utf8ToBase64('﻿本文') })).remote.file('a.md');
  assert.equal(f!.text, '﻿本文');
});

test('改行コードが混ざったファイルは編集対象にしない', async () => {
  const { editableShape } = await import('../src/core/text.ts');
  assert.equal(editableShape('a\r\nb\r\n'), true);
  assert.equal(editableShape('a\nb\n'), true);
  assert.equal(editableShape('a\r\nb\n'), false);
  assert.equal(editableShape('a\rb'), false);
});
