import { AuthError, ConflictError, RejectedError, TransportError, type VaultRemote } from '../remote/types';
import { replaceLine, setTaskDone } from './tasks';
import type { Vault } from './vault';

export type LineResult = { ok: true; line: string } | { ok: false; reason: string; retry: boolean };

/**
 * Change one line in a file that agents rewrite all the time (Tasks.md).
 * Each attempt starts from what the remote holds now and replaces only the line
 * whose text is `from`; a version conflict means "someone wrote meanwhile", so it
 * re-reads and re-applies. Other lines are never taken from the phone's copy.
 */
export async function replaceRemoteLine(remote: VaultRemote, vault: Vault, path: string, from: string, to: string, message: string): Promise<LineResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let latest;
    try {
      latest = await remote.file(path);
    } catch (e) {
      return { ok: false, reason: e instanceof AuthError ? e.message : '電波が戻ったら、もう一度押してください', retry: !(e instanceof AuthError) };
    }
    if (!latest) return { ok: false, reason: 'ファイルが見つかりません', retry: false };
    const r = replaceLine(latest.text, from, to);
    if ('error' in r) {
      await vault.applySaved(path, latest.sha, latest.text);
      return { ok: false, reason: r.error + '。最新を表示します', retry: false };
    }
    if (r.text === latest.text) {
      await vault.applySaved(path, latest.sha, latest.text);
      return { ok: true, line: to };
    }
    try {
      const put = await remote.put(path, r.text, latest.sha, message);
      await vault.applySaved(path, put.sha, r.text);
      return { ok: true, line: to };
    } catch (e) {
      // Conflict: someone wrote. Unknown outcome: re-read; if our line is already there, it is a no-op.
      if (e instanceof ConflictError || e instanceof TransportError) continue;
      if (e instanceof AuthError || e instanceof RejectedError) return { ok: false, reason: e.message, retry: false };
      return { ok: false, reason: String(e), retry: true };
    }
  }
  return { ok: false, reason: '何度か競合しました。少し置いてから押してください', retry: true };
}

/**
 * Add text at the end of whatever the file holds now (e.g. the owner's reply under a result note).
 * Same discipline as line replace: start from the latest version, retry on conflict,
 * and on an unknown outcome check whether the text already landed before sending again.
 */
export async function appendRemote(remote: VaultRemote, vault: Vault, path: string, text: string, message: string): Promise<LineResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let latest;
    try {
      latest = await remote.file(path);
    } catch (e) {
      return { ok: false, reason: e instanceof AuthError ? e.message : '電波が戻ったら、もう一度押してください', retry: true };
    }
    if (!latest) return { ok: false, reason: 'ノートが見つかりません', retry: false };
    if (latest.text.includes(text.trim())) {
      await vault.applySaved(path, latest.sha, latest.text);
      return { ok: true, line: text };
    }
    const eol = latest.text.includes('\r\n') ? '\r\n' : '\n';
    const body = latest.text.replace(/\s*$/, '') + eol + eol + text.trim().replace(/\r?\n/g, eol) + eol;
    try {
      const put = await remote.put(path, body, latest.sha, message);
      await vault.applySaved(path, put.sha, body);
      return { ok: true, line: text };
    } catch (e) {
      if (e instanceof ConflictError || e instanceof TransportError) continue;
      if (e instanceof AuthError || e instanceof RejectedError) return { ok: false, reason: e.message, retry: false };
      return { ok: false, reason: String(e), retry: true };
    }
  }
  return { ok: false, reason: '何度か競合しました。少し置いてから押してください', retry: true };
}

/**
 * Rewrite a file from its newest version (or create it), e.g. adding a line under today's diary heading.
 * `landed` says whether the change is already in a version (so a lost response is not applied twice).
 */
export async function editRemote(
  remote: VaultRemote,
  vault: Vault,
  path: string,
  transform: (raw: string | null) => string,
  landed: (raw: string) => boolean,
  message: string,
): Promise<LineResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let latest;
    try {
      latest = await remote.file(path);
    } catch (e) {
      return { ok: false, reason: e instanceof AuthError ? e.message : '電波が戻ったら送ります', retry: !(e instanceof AuthError) };
    }
    if (latest && landed(latest.text)) {
      await vault.applySaved(path, latest.sha, latest.text);
      return { ok: true, line: '' };
    }
    const next = transform(latest?.text ?? null);
    try {
      const put = await remote.put(path, next, latest?.sha ?? '', message);
      await vault.applySaved(path, put.sha, next);
      return { ok: true, line: '' };
    } catch (e) {
      if (e instanceof ConflictError || e instanceof TransportError) continue;
      if (e instanceof AuthError || e instanceof RejectedError) return { ok: false, reason: e.message, retry: false };
      return { ok: false, reason: String(e), retry: true };
    }
  }
  return { ok: false, reason: '電波が戻ったら送ります', retry: true };
}

/** Tick a task the way the Tasks plugin does. Returns the line as written, which undo needs. */
export function completeTask(remote: VaultRemote, vault: Vault, path: string, original: string, today: string) {
  const to = setTaskDone(original.replace(/\r$/, ''), true, today);
  if (!to) return Promise.resolve<LineResult>({ ok: false, reason: 'タスクの行ではありません', retry: false });
  return replaceRemoteLine(remote, vault, path, original, to, `mobile: 完了 ${path}`);
}

/** Put the exact original line back (not a recomputed one). */
export function undoComplete(remote: VaultRemote, vault: Vault, path: string, written: string, original: string) {
  return replaceRemoteLine(remote, vault, path, written, original.replace(/\r$/, ''), `mobile: 完了を取り消し ${path}`);
}

/** Kept for callers and tests that toggle by state. */
export function toggleTaskLine(remote: VaultRemote, vault: Vault, path: string, original: string, done: boolean, today: string) {
  const to = setTaskDone(original.replace(/\r$/, ''), done, today);
  if (!to) return Promise.resolve<LineResult>({ ok: false, reason: 'タスクの行ではありません', retry: false });
  return replaceRemoteLine(remote, vault, path, original, to, `mobile: ${done ? '完了' : '完了を外す'} ${path}`);
}
