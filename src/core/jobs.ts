/**
 * Jobs are the vault's existing unattended queue (00_Cockpit/jobs/, picked up by
 * the hourly job-runner on GitHub Actions). The phone writes the same file that
 * `jobs.py new` writes, with the same minimal YAML, so the runner cannot tell
 * the difference. No second queue.
 */

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'vetoed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobInfo = {
  path: string;
  id: string;
  status: JobStatus;
  kind: string;
  slug: string;
  prompt: string;
  created: string;
  finished: string;
  artifacts: string[];
  unknowns: string;
  failure: string;
  origin: string;
  runnerHint: string;
};

/* ——— the minimal YAML of 07_System/scripts/proposal.py, line for line ——— */

export function fmParse(lines: string[]): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1],
      rest = m[2].trim();
    if (rest === '|') {
      const buf: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i] === '')) {
        buf.push(lines[i].startsWith('  ') ? lines[i].slice(2) : '');
        i++;
      }
      while (buf.length && buf[buf.length - 1] === '') buf.pop();
      d[key] = buf.join('\n');
      continue;
    }
    if (rest.startsWith('[')) {
      try {
        d[key] = JSON.parse(rest);
      } catch {
        d[key] = rest
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((x) => x.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
      }
    } else if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) d[key] = JSON.parse(rest);
    else d[key] = rest;
    i++;
  }
  return d;
}

export function fmDump(d: Record<string, unknown>) {
  const out = ['---'];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) out.push(`${k}: ${JSON.stringify(v)}`);
    else if (typeof v === 'string' && (v.includes('\n') || v.length > 80 || v.includes(': ') || /^[["{']/.test(v))) {
      out.push(`${k}: |`);
      for (const ln of v.split('\n')) out.push('  ' + ln);
    } else if (typeof v === 'boolean') out.push(`${k}: ${v ? 'True' : 'False'}`);
    else out.push(`${k}: ${v}`);
  }
  out.push('---');
  return out.join('\n');
}

function splitFm(text: string): [string[], string] {
  const lines = text.split('\n');
  if (!lines.length || lines[0].trim() !== '---') return [[], text];
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') return [lines.slice(1, i), lines.slice(i + 1).join('\n')];
  return [[], text];
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export function readJob(path: string, raw: string): JobInfo | null {
  const m = path.match(/^00_Cockpit\/jobs\/(queued|running|done|failed|vetoed)\/(JOB-[^/]+)\.md$/);
  if (!m) return null;
  const d = fmParse(splitFm(raw.replace(/\r\n/g, '\n'))[0]);
  return {
    path,
    id: str(d.id) || m[2].split('_')[0],
    status: m[1] as JobStatus,
    kind: str(d.kind),
    slug: str(d.slug),
    prompt: str(d.prompt),
    created: str(d.created),
    finished: str(d.finished_at) === 'None' ? '' : str(d.finished_at),
    artifacts: list(d.artifacts),
    unknowns: str(d.unknowns),
    failure: str(d.failure_stage) === 'None' ? '' : str(d.failure_stage),
    origin: str(d.origin),
    runnerHint: str(d.runner_hint),
  };
}

/* ——— a request from the phone ——— */

export type RequestKind = 'research' | 'draft';

const pad = (n: number) => String(n).padStart(2, '0');
export function isoJst(d: Date) {
  // Same shape as jobs.py iso(): local time with offset.
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

/** jobs.py slugify(): word characters (Japanese included) and hyphens, at most 40. */
export function slugify(s: string) {
  return (
    s
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'job'
  );
}

/** Next free JOB-YYYYMMDD-NN across every status folder (jobs.py next_id()). */
export function nextJobId(existing: string[], day: Date) {
  const stamp = `${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}`;
  const used = new Set(existing.map((p) => p.match(/JOB-(\d{8})-(\d{2,})/)).filter((m) => m && m[1] === stamp).map((m) => Number(m![2])));
  let n = used.size + 1;
  while (used.has(n)) n++;
  return `JOB-${stamp}-${pad(n)}`;
}

export function requestJob(opts: { request: string; kind: RequestKind; context?: string; now: Date; existing: string[] }) {
  const { request, kind, context, now } = opts;
  const id = nextJobId(opts.existing, now);
  const day = id.slice(4, 12);
  const slug = slugify('mobile-' + request.split('\n')[0].slice(0, 24));
  const out = `00_Cockpit/thinking/スマホ依頼_${day}_${slug.replace(/^mobile-/, '')}.md`;
  const what = kind === 'research' ? '調べて、答えと根拠をまとめる' : 'レビューできる下書きを作る';
  const prompt = [
    `関が移動中にスマホ（vault-mobile）から頼んだ。${what}。`,
    '',
    '## 依頼',
    request.trim(),
    ...(context ? ['', '## この依頼が出た場所', context.trim()] : []),
    '',
    '## 進め方',
    `- 結果は ${out} に新規で書く（既存ノートは書き換えない）`,
    '- 冒頭3行で結論。関は移動中にスマホで読むので、短く、見出しで区切る',
    '- 根拠は Vault のパス（`path:行`）か URL で示す。推測は推測と書く',
    '- 確かめられなかったことは「## 未確認」に書く（無ければ「無い」と書く）',
    '- 外部への送信・発言・PR作成はしない。判断が要る点は結果に「関に聞くこと」として残す',
    '- 文体は .claude/rules/prose.md に従う',
  ].join('\n');
  const meta: Record<string, unknown> = {
    id,
    status: 'queued',
    kind,
    actor: 'ACT-SEKI',
    created: isoJst(now),
    slug,
    prompt,
    inputs: [],
    write_scope: ['00_Cockpit/jobs/**', out],
    done_when: `${out} が存在し、依頼への答え（結論）・根拠・未確認を含む`,
    verify: `F="${out}"; test -f "$F" && grep -q "未確認" "$F"`,
    budget_turns: 25,
    origin: 'vault-mobile（関がスマホから依頼）',
    attempts: 0,
    infra_retries: 0,
    package_id: '',
    runner_hint: 'actions',
    origin_text: '',
    origin_sha: '',
    closes_origin: false,
    artifacts: [],
    evidence: [],
    unknowns: '',
    base_rev: null,
  };
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const body = `
# ${id} ${slug}

## 📋 指示
${prompt}

## ✅ 完了条件
${meta.done_when}

## 📦 成果物（実行後に \`jobs.py artifact\` で足す）
（未記入）

## 🧾 根拠（完了条件ごとに \`<path>:<行>\` で）
（未記入）

## ❓ 未確認
（未記入）

## 🔬 検証
\`\`\`bash
${meta.verify}
\`\`\`

## 🔓 この Job の done が閉じる範囲
この Job の契約だけ。元の約束は閉じない

## 📝 実行ログ
- ${t} queued（ACT-SEKI / origin: ${meta.origin}）
`;
  return { id, path: `00_Cockpit/jobs/queued/${id}_${slug}.md`, output: out, text: fmDump(meta) + '\n' + body.replace(/^\n+/, '') };
}
