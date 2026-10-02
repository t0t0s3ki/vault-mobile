import { base64ToBytes, base64ToUtf8, utf8ToBase64 } from '../core/text';
import { AuthError, ConflictError, RejectedError, TransportError, type RemoteEntry, type VaultRemote } from './types';

export type GitHubTarget = { owner: string; repo: string; branch: string };
type Fetch = typeof fetch;

/**
 * Talks to api.github.com straight from the device. No server of ours sits in
 * between, so the Vault's text never passes through a host we would have to run.
 * The token is supplied per call by `token()` and is never stored here.
 */
export class GitHubRemote implements VaultRemote {
  readonly id: string;
  readonly label: string;

  constructor(
    private target: GitHubTarget,
    private token: () => Promise<string>,
    private http: Fetch = (...a) => fetch(...a),
    private api = 'https://api.github.com',
  ) {
    this.id = `github:${target.owner}/${target.repo}@${target.branch}`;
    this.label = `${target.owner}/${target.repo}（${target.branch}）`;
  }

  private path(p: string) {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  private async call(url: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
    let res: Response;
    let token: string;
    try {
      token = await this.token();
    } catch {
      throw new AuthError('トークンを取り出せませんでした');
    }
    try {
      res = await this.http(this.api + url, {
        ...init,
        cache: 'no-store',
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new TransportError();
    }
    if (res.status === 401) throw new AuthError();
    if (res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after'))))
      throw new RejectedError('GitHubの利用上限に達しました。しばらく待ってください');
    if (res.status === 403) throw new AuthError('このリポジトリへの権限がありません');
    if (res.status >= 500) throw new TransportError(`GitHubが応答しませんでした（${res.status}）`);
    return res;
  }

  async tree() {
    const { owner, repo, branch } = this.target;
    const head = await this.call(
      `/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
      {},
      'application/vnd.github.sha',
    );
    if (!head.ok) throw new TransportError(`ブランチを読めませんでした（${head.status}）`);
    const commit = (await head.text()).trim();
    const res = await this.call(`/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`);
    if (!res.ok) throw new TransportError(`一覧を読めませんでした（${res.status}）`);
    const body = (await res.json()) as { truncated: boolean; tree: { path: string; type: string; sha: string; size?: number }[] };
    if (body.truncated) throw new TransportError('ファイル数が多すぎて一覧を取り切れませんでした');
    const entries: RemoteEntry[] = body.tree
      .filter((t) => t.type === 'blob')
      .map((t) => ({ path: t.path, sha: t.sha, size: t.size ?? 0 }));
    return { commit, entries };
  }

  /** GraphQL fetches up to 100 blobs per request; a few requests run side by side. */
  async texts(shas: string[]) {
    const out = new Map<string, string>();
    const batches: string[][] = [];
    for (let i = 0; i < shas.length; i += 100) batches.push(shas.slice(i, i + 100));
    let next = 0;
    const worker = async () => {
      while (next < batches.length) await this.batch(batches[next++], out);
    };
    await Promise.all(Array.from({ length: Math.min(4, batches.length) }, worker));
    return out;
  }

  private async batch(batch: string[], out: Map<string, string>) {
    const { owner, repo } = this.target;
    const fields = batch
      .map((sha, k) => `b${k}: object(oid: "${sha.replace(/[^0-9a-f]/g, '')}") { ... on Blob { text isBinary isTruncated } }`)
      .join(' ');
    const res = await this.call('/graphql', {
      method: 'POST',
      body: JSON.stringify({
        query: `query($o:String!,$r:String!){ repository(owner:$o,name:$r){ ${fields} } }`,
        variables: { o: owner, r: repo },
      }),
    });
    if (!res.ok) throw new TransportError(`本文を読めませんでした（${res.status}）`);
    const json = (await res.json()) as { data?: { repository: Record<string, { text: string | null; isBinary: boolean; isTruncated: boolean } | null> } };
    const repoData = json.data?.repository;
    if (!repoData) throw new TransportError('本文を読めませんでした');
    for (const [k, sha] of batch.entries()) {
      const blob = repoData['b' + k];
      if (!blob || blob.isBinary) continue;
      if (blob.isTruncated || blob.text === null) out.set(sha, await this.blobText(sha));
      else out.set(sha, blob.text);
    }
  }

  private async blobJson(sha: string) {
    const { owner, repo } = this.target;
    const res = await this.call(`/repos/${owner}/${repo}/git/blobs/${sha}`);
    if (!res.ok) throw new TransportError(`ファイルを読めませんでした（${res.status}）`);
    return (await res.json()) as { content: string; encoding: string };
  }
  private async blobText(sha: string) {
    return base64ToUtf8((await this.blobJson(sha)).content);
  }

  async bytes(sha: string, path: string) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const type =
      { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' }[ext] ??
      'application/octet-stream';
    return new Blob([base64ToBytes((await this.blobJson(sha)).content) as BlobPart], { type });
  }

  async file(path: string) {
    const { owner, repo, branch } = this.target;
    const res = await this.call(`/repos/${owner}/${repo}/contents/${this.path(path)}?ref=${encodeURIComponent(branch)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new TransportError(`ファイルを読めませんでした（${res.status}）`);
    const body = (await res.json()) as { type: string; sha: string; content?: string; encoding?: string };
    if (body.type !== 'file') return null;
    const text = body.encoding === 'base64' && body.content ? base64ToUtf8(body.content) : await this.blobText(body.sha);
    return { sha: body.sha, text };
  }

  async put(path: string, text: string, baseSha: string, message: string) {
    const { owner, repo, branch } = this.target;
    const res = await this.call(`/repos/${owner}/${repo}/contents/${this.path(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: utf8ToBase64(text), sha: baseSha, branch }),
    });
    // 409: the file (or the branch head) moved. 404: the file is gone. 422 is a conflict only when the sha does not match.
    if (res.status === 409 || res.status === 404) throw new ConflictError();
    if (res.status === 422) {
      const message = String(((await res.json().catch(() => ({}))) as { message?: string }).message ?? '');
      if (/does not match|sha/i.test(message)) throw new ConflictError();
      throw new RejectedError(`GitHubが保存を受け付けませんでした：${message || res.status}`);
    }
    if (!res.ok) throw new TransportError(`保存できませんでした（${res.status}）`);
    const body = (await res.json()) as { content: { sha: string } };
    return { sha: body.content.sha };
  }
}
