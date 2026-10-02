/** A file as the remote branch currently holds it. `sha` is the Git blob id. */
export type RemoteEntry = { path: string; sha: string; size: number };
export type RemoteFile = { sha: string; text: string };

/**
 * The only door to the Vault's canonical copy. Reads are by blob id so the
 * cache can tell what changed; writes are compare-and-swap on the file's blob id.
 */
export interface VaultRemote {
  /** Stable id of repository + branch. Drafts are bound to it. */
  readonly id: string;
  readonly label: string;
  tree(): Promise<{ commit: string; entries: RemoteEntry[] }>;
  /** Text of many blobs at once. Missing ids are simply absent from the map. */
  texts(shas: string[]): Promise<Map<string, string>>;
  bytes(sha: string, path: string): Promise<Blob>;
  /** Current content of one file, or null when it no longer exists. */
  file(path: string): Promise<RemoteFile | null>;
  /**
   * Replace `path` only if the remote still holds `baseSha`.
   * Throws ConflictError when it does not, TransportError when the outcome is unknown.
   */
  put(path: string, text: string, baseSha: string, message: string): Promise<{ sha: string }>;
}

/** The remote refused because the file is no longer at the version we read. */
export class ConflictError extends Error {
  constructor(message = 'ほかの場所で更新されています') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** The request may or may not have been applied (offline, timeout, lost response). */
export class TransportError extends Error {
  constructor(message = '通信できませんでした') {
    super(message);
    this.name = 'TransportError';
  }
}

/** The remote refused for a reason other than a version mismatch. Nothing was applied. */
export class RejectedError extends Error {
  constructor(message = 'GitHubが保存を受け付けませんでした') {
    super(message);
    this.name = 'RejectedError';
  }
}

/** Credentials were rejected. Drafts stay; nothing is retried automatically. */
export class AuthError extends Error {
  constructor(message = '認証が切れています') {
    super(message);
    this.name = 'AuthError';
  }
}
