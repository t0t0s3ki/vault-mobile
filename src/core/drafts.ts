/**
 * Long-form writing ("じっくり書く"). A draft is a note in the drafts folder, named the way the
 * desk app on the PC names its manuscripts (YYYYMMDD_無題.md), so either side can continue it.
 * Memos stay the quick inbox; drafts are not sorted away by the agents.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A file name only a new draft can have: 20261008_無題.md, 20261008_無題2.md, … */
export const NEW_DRAFT = /^\d{8}_無題(\d*)\.md$/;

/** The first free name for today's draft. `taken` says whether a path is in use (vault or device). */
export function draftPath(folder: string, taken: (path: string) => boolean, d = new Date()) {
  for (let n = 1; ; n++) {
    const path = `${folder}/${day(d)}_無題${n === 1 ? '' : n}.md`;
    if (!taken(path)) return path;
  }
}

/** True for a not-yet-existing draft directly in the drafts folder. */
export function isNewDraft(folder: string, path: string) {
  return path.startsWith(folder + '/') && NEW_DRAFT.test(path.slice(folder.length + 1));
}

/** The same frontmatter the desk app writes, so the vault's lint and views treat both alike. */
export function withFront(body: string, d = new Date()) {
  if (body.startsWith('---\n')) return body;
  const date = iso(d);
  return `---\ntype: note\ntags: [second-desk]\nstatus: seed\ncreated: ${date}\nupdated: ${date}\nsource: "スマホで書いた原稿"\n---\n${body}`;
}

/** Text typed into the ＋ sheet before choosing "じっくり書く" carries over into the editor. Memory only. */
let seed = '';
export function setSeed(text: string) {
  seed = text;
}
export function takeSeed() {
  const s = seed;
  seed = '';
  return s;
}
