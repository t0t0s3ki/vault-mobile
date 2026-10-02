import { AuthError, ConflictError, RejectedError, TransportError, type VaultRemote } from '../remote/types';
import { applyToggle } from './tasks';
import type { Vault } from './vault';

export type ToggleResult = { ok: true } | { ok: false; reason: string; retry: boolean };

/**
 * Tick one task in a file that agents rewrite all the time (Tasks.md).
 * Each attempt starts from what the remote holds now and changes only the line
 * whose text matches; a version conflict means "someone wrote meanwhile", so it
 * re-reads and re-applies. Other lines are never taken from the phone's copy.
 */
export async function toggleTaskLine(remote: VaultRemote, vault: Vault, path: string, original: string, done: boolean, today: string): Promise<ToggleResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let latest;
    try {
      latest = await remote.file(path);
    } catch (e) {
      return { ok: false, reason: e instanceof AuthError ? e.message : '電波が戻ったら、もう一度押してください', retry: !(e instanceof AuthError) };
    }
    if (!latest) return { ok: false, reason: 'ファイルが見つかりません', retry: false };
    const r = applyToggle(latest.text, original, done, today);
    if ('error' in r) {
      await vault.applySaved(path, latest.sha, latest.text);
      return { ok: false, reason: r.error + '。最新を表示します', retry: false };
    }
    if (r.text === latest.text) {
      await vault.applySaved(path, latest.sha, latest.text);
      return { ok: true };
    }
    try {
      const put = await remote.put(path, r.text, latest.sha, `mobile: ${done ? '完了' : '完了を外す'} ${path}`);
      await vault.applySaved(path, put.sha, r.text);
      return { ok: true };
    } catch (e) {
      if (e instanceof ConflictError) continue;
      // Unknown outcome: the next attempt re-reads; if the line is already ticked, applyToggle returns it unchanged.
      if (e instanceof TransportError) continue;
      if (e instanceof AuthError || e instanceof RejectedError) return { ok: false, reason: e.message, retry: false };
      return { ok: false, reason: String(e), retry: true };
    }
  }
  return { ok: false, reason: '何度か競合しました。少し置いてから押してください', retry: true };
}
