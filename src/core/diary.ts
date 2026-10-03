/**
 * The diary's raw material (08_Life/09_日記/_原料/README.md): one file per month, a
 * "## YYYY-MM-DD" heading per day, and one line per entry in 関's own words with a
 * category emoji in front. Nothing is summarised or reworded here.
 */
export const DIARY_DIR = '08_Life/09_日記/_原料';

export const DIARY_KINDS = [
  ['🎮', 'ゲーム'],
  ['🚗', '車'],
  ['🎵', '音楽'],
  ['🍳', '食'],
  ['📺', '映像'],
  ['📖', '読み物'],
  ['🏠', '家'],
  ['💪', '体'],
  ['💰', 'お金'],
  ['🌏', 'その他'],
] as const;

const pad = (n: number) => String(n).padStart(2, '0');
export function diaryPath(d: Date) {
  return `${DIARY_DIR}/${d.getFullYear()}-${pad(d.getMonth() + 1)}.md`;
}
export function dayOf(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A fresh month file, shaped like the existing ones. */
export function newMonth(d: Date) {
  const day = dayOf(d);
  return `---\ntype: note\ntags: [life/日記]\ncreated: ${day}\nupdated: ${day}\n---\n\n# 🌿 原料 ${day.slice(0, 7)}\n\n書き方は [[08_Life/09_日記/_原料/README|README]]。関の言葉のまま、要約せずに置く。\n`;
}

/** One entry line: the words as given, kept on one line (line breaks become spaces). */
export function diaryLine(words: string, emoji = '') {
  const text = words.trim().replace(/\s*\r?\n\s*/g, ' ');
  return `- ${emoji ? emoji + ' ' : ''}${text}`;
}

/**
 * Put `line` at the end of today's block, creating the day heading (and the file) if needed.
 * Everything else in the file is left exactly as it was, including line endings.
 */
export function addToDiary(raw: string | null, d: Date, line: string) {
  const day = dayOf(d);
  const base = raw ?? newMonth(d);
  const eol = base.includes('\r\n') ? '\r\n' : '\n';
  const lines = base.split(/\r?\n/);
  const head = lines.findIndex((l) => l.trim() === `## ${day}`);
  if (head < 0) {
    const body = base.replace(/\s*$/, '');
    return body + eol + eol + `## ${day}` + eol + eol + line + eol;
  }
  // End of today's block: the next heading of the same or higher level, or the end of the file.
  let end = lines.findIndex((l, i) => i > head && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  // Insert after the last non-blank line of the block.
  let at = end;
  while (at > head + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, line);
  if (at === head + 1) lines.splice(at, 0, ''); // keep a blank line under the heading
  return lines.join(eol);
}
