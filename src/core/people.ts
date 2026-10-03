/**
 * "佐藤さんに「…」と聞く" → copy the quoted wording and open that person in Slack.
 * Names and IDs come from member tables already in the vault (| 氏名 | … | Slack ID |),
 * the workspace from Slack links already in the vault. Nothing is sent; the owner sends it.
 */
export type Person = { name: string; id: string };

export function readMembers(raw: string): Person[] {
  const out: Person[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim().replace(/`/g, ''));
    const id = cells.map((c) => c.match(/^([UWD][A-Z0-9]{8,})/)?.[1]).find(Boolean);
    const name = cells[1];
    if (id && name && !/氏名|名前|---/.test(name)) out.push({ name: name.replace(/\s+/g, ' '), id });
  }
  return out;
}

export function slackDomain(texts: string[]) {
  for (const t of texts) {
    const m = t.match(/https:\/\/([a-z0-9-]+)\.slack\.com\//);
    if (m) return m[1];
  }
  return '';
}

/** The person addressed ("佐藤さんに…", "小林さんへ…") and the words in 「」 to send them. */
export function askOf(text: string, people: Person[]) {
  const who = text.match(/([\p{Script=Han}\p{Script=Katakana}]{1,4})さん(?:に|へ)/u)?.[1];
  const words = text.match(/「([^」]{4,})」/)?.[1];
  if (!who || !words) return null;
  const person = people.find((p) => p.name.replace(/\s/g, '').startsWith(who));
  return { who, words, person };
}

/** A DM channel opens the conversation itself; a user ID opens the profile (one tap from 「メッセージ」). */
export function profileUrl(domain: string, id: string) {
  if (!domain || !id) return '';
  return id.startsWith('D') ? `https://${domain}.slack.com/archives/${id}` : `https://${domain}.slack.com/team/${id}`;
}
