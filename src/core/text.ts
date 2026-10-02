/**
 * A textarea normalizes CRLF to LF and shows a BOM as an invisible character.
 * Editing happens on the normalized form; saving restores the file's own shape
 * so a one-word edit does not rewrite every line ending.
 */
export type TextShape = { eol: '\n' | '\r\n'; bom: boolean };

export function toEditable(raw: string): { body: string; shape: TextShape } {
  const bom = raw.startsWith('﻿');
  const text = bom ? raw.slice(1) : raw;
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return { body: text.replace(/\r\n/g, '\n'), shape: { eol: crlf > lf ? '\r\n' : '\n', bom } };
}

/** Mixed line endings or a lone CR cannot survive a textarea round trip. Such files are read-only here. */
export function editableShape(raw: string) {
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/(?<!\r)\n/g) || []).length;
  return !/\r(?!\n)/.test(raw) && !(crlf && lf);
}

export function fromEditable(body: string, shape: TextShape): string {
  const text = shape.eol === '\r\n' ? body.replace(/\r?\n/g, '\r\n') : body;
  return (shape.bom ? '﻿' : '') + text;
}

export function utf8ToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string) {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64ToUtf8(b64: string) {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(base64ToBytes(b64));
}

/** Minimal line diff (LCS) for the conflict screen. Large inputs fall back to whole-block. */
export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split('\n'),
    y = b.split('\n');
  if (x.length * y.length > 4_000_000)
    return [...x.map((text) => ({ kind: 'del' as const, text })), ...y.map((text) => ({ kind: 'add' as const, text }))];
  const n = x.length,
    m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) out.push({ kind: 'same', text: x[i++] }), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: 'del', text: x[i++] });
    else out.push({ kind: 'add', text: y[j++] });
  }
  while (i < n) out.push({ kind: 'del', text: x[i++] });
  while (j < m) out.push({ kind: 'add', text: y[j++] });
  return out;
}
