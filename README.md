# vault-mobile

A phone-first PWA onto a Markdown vault (Obsidian style) that lives in a GitHub repository and is shared with AI agents. Japanese UI.

It is built for the moments away from the desk: *where does everything stand, what do I do next, and what should the agents be doing meanwhile*.

## What the home screen ("いま") does

- **Throw things in.** One field: save it as a memo (a unique note), hand it to the agents as a request, or clip a URL.
- **Next promises.** Deadline items from `Tasks.md`, nearest first; only the last week gets a countdown. Tap for the status: the item's own progress notes, the linked note, and the session-log section that most likely concerns it. "終わった" ticks the line (`- [x] … ✅ date`); moving it to the done log stays with the vault's night routine.
- **What the agents did.** New results and failures of requests, plus today's agent-signed session-log headings. Nothing is shown when nothing changed.
- **Three quick buttons** at most, with total minutes, and **one Spark** for the ride. No full lists to patrol, no counters.

Requests become files in the vault's existing unattended queue (`00_Cockpit/jobs/queued/`), written exactly as the vault's `jobs.py new` writes them (checked against its Python parser in tests). The result comes back as one note.

Ticking a task re-reads the newest file and changes only the line with the same text, so edits other agents made meanwhile are kept.

## How it works

- **No server.** The page is static. The phone talks to `api.github.com` directly, so note text never passes through a host run by the app's author.
- **Bring your own repo and token.** Owner, repository, branch and a fine-grained personal access token are entered on the device. Nothing about a particular vault is in the code.
- **Offline reading.** A copy of every Markdown file is kept in IndexedDB. Later syncs only download blobs whose id changed.
- **Encrypted on the device.** The token, note copies, drafts, images and reading positions are sealed with AES-GCM. Storage keys are HMACed so file paths are not readable either. The key comes from a passkey via the WebAuthn PRF extension (Face ID on iOS 18+), or from a passphrase (PBKDF2, 600k iterations) as a fallback. It lives in memory only and is dropped after 10 minutes in the background.
- **Never overwrites someone else's change.** Every save is compare-and-swap on the blob SHA that was read. A stale SHA shows base / mine / latest and waits for a decision. A save whose outcome is unknown (lost response) is verified by re-reading before anything is resent.
- **Source editing only.** YAML and unknown syntax are never re-serialized. CRLF and BOM are restored on save; files with mixed line endings are read-only.

## Use

Open the published page in Safari, then Share → Add to Home Screen. On first launch choose "GitHub の Vault につなぐ", enter the repository and a token, then lock the device with a passkey.

Token: create a fine-grained token limited to the one repository, with **Contents: Read and write** only, and an expiry.

"ダミーの Vault で試す" runs entirely on bundled dummy notes. Its settings screen can inject failures (offline, lost response, concurrent edit, deletion) to exercise the save flow.

## Develop

```sh
npm install
npm run dev        # http://127.0.0.1:4330
npm run typecheck
npm test
npm run build      # adds a Content-Security-Policy meta tag
```

`tests/work.test.ts` pins the task, job and clip writers (line-level rebase under concurrent edits, lost responses, Job files read back by the vault's Python parser). `tests/save.test.ts` pins the save contract (ordering, edits during save, stale SHA, deletion, offline, lost response, reload, foreign drafts, auth failure, storage failure, CRLF/BOM, unknown syntax). `tests/lock.test.ts` checks that nothing readable reaches IndexedDB.

## Reading order

1. `src/core/save.ts` — save state machine (editing / saving / unknown / conflict)
2. `src/remote/types.ts` → `mock.ts` / `github.ts` — the remote boundary
3. `src/core/lock.ts`, `src/core/sealed-store.ts` — device encryption
4. `src/core/vault.ts` — device copy, link resolution, search
5. `src/ui/` — screens

## Not yet

- Queue for edits made fully offline and sent later in bulk
- Recreating a file that was moved or deleted while being edited (the text can be copied)
- Signing in with a GitHub App instead of a personal token
