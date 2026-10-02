/**
 * Dummy Vault for the demo mode and tests. Contents are invented; the shapes
 * (frontmatter, aliases, callouts, embeds, same-name notes, CRLF+BOM, broken YAML,
 * Dataview/Mermaid blocks, protected files) mirror what the real Vault contains.
 */
const long = [
  '---',
  'aliases: [長文]',
  'type: reference',
  'updated: 2026-08-15',
  'reviewed: 2026-08-15',
  '---',
  '# 長文サンプル',
  '',
  '読書位置の保存を確かめるための長いノート。',
  ...Array.from({ length: 24 }, (_, i) =>
    [
      '',
      `## 第${i + 1}節`,
      '',
      `これは第${i + 1}節の本文。段落が続くと、どこまで読んだかを忘れる。だから、閉じて開き直したときに同じ場所へ戻れることが大事になる。スクロールの位置を覚えておけば、続きから読める。`,
      '',
      '二つ目の段落。[[読み心地]]へのリンクを置いておくと、寄り道してから戻ってくる操作も試せる。',
    ].join('\n'),
  ),
  '',
].join('\n');

const cover =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320"><rect width="240" height="320" fill="#c9b99a"/><rect x="20" y="20" width="200" height="280" fill="none" stroke="#5b4a2f" stroke-width="3"/><text x="120" y="150" font-size="28" text-anchor="middle" fill="#3b2f1c" font-family="serif">読書会</text><text x="120" y="190" font-size="14" text-anchor="middle" fill="#3b2f1c" font-family="serif">ダミーの表紙</text></svg>';

export const demoVault: Record<string, string | { bytes: Uint8Array; type: string }> = {
  '00_Cockpit/Tasks.md': `---
type: tasks
updated: 2026-10-02
---
# Tasks

- [ ] 試作アプリの画面を見る 📅 2026-10-05
- [x] 読書会の日程を決める ✅ 2026-10-01

> このファイルは専用の手順で更新する（ダミー）。スマホからは読むだけ。
`,
  '02_Projects/1001_試作アプリ/README.md': `---
aliases: [試作アプリ, モバイル試作]
type: project
status: active
updated: 2026-10-03
tags: [project, mobile]
---
# 1001 試作アプリ

スマホで[[読み心地]]よくノートを読むための試作。設計の芯は[[余白の設計#行間]]にある。

> [!note] いまの状態
> 段階1（読む・探す）を作っている。編集は段階2。

## やること

- [ ] ホームの「続きから」を作る
- [ ] 検索を軽くする
- [x] ダミーVaultを用意する

## 関連

- [[議事録_20261001]]
- [[1002_読書会/README|読書会の入口]]（同名ノートの解決を試す）
- [[存在しないノート]]（未作成リンク）

\`\`\`dataview
TABLE status FROM "02_Projects"
\`\`\`

\`\`\`mermaid
graph TD; 読む-->探す; 探す-->直す
\`\`\`
`,
  '02_Projects/1002_読書会/README.md': `---
aliases: [読書会]
type: project
status: active
updated: 2026-09-28
---
# 1002 読書会

月に一度、一冊を読む会（ダミー）。

![[表紙.svg|240]]

> [!question]- 次に読む本は？
> 候補は三冊。まだ決めていない。

%% ここは Obsidian のコメント。表示しない %%
`,
  '02_Projects/1002_読書会/議事録_20261001.md': `---
type: minutes
created: 2026-10-01
updated: 2026-10-01
---
# 読書会 2026-10-01

- 参加：3名（ダミー）
- 決まったこと：次回は 11/5
- 宿題：[[余白の設計]]を読んでくる ^homework

> [!warning] 未決
> 会場がまだ決まっていない。
`,
  '04_Think/読み心地.md': `---
aliases: [読みやすさ, 読む気になる]
type: think
updated: 2026-09-30
---
# 読み心地

読む気になるかどうかは、開いた最初の一画面で決まる。

文字が詰まっていると、内容より先に疲れが来る。行間・余白・一行の長さが揃っていると、目は勝手に先へ進む。

## 三つの条件

1. **すぐ開く** — 待たされると読む気が消える
2. **途中から戻れる** — 前に読んだ場所を覚えている
3. **寄り道できる** — リンクを踏んで、また戻ってこられる

==迷ったら、削る。==

関連：[[余白の設計]]・[[1001_試作アプリ/README|試作アプリ]]
`,
  '04_Think/余白の設計.md': `---
aliases: [余白]
type: think
updated: 2026-09-20
---
# 余白の設計

## 行間

本文の行間は文字の大きさの1.8倍前後。日本語は漢字が詰まって見えるので、英語より広めにとる。

## 一行の長さ

一行は35〜40字。長すぎると次の行頭を見失い、短すぎると目が忙しい。

## 段落

段落の間は一行分あける。見出しの上は下より広く。

| 要素 | 目安 |
| --- | --- |
| 本文 | 17px |
| 行間 | 1.85 |
| 一行 | 38字 |

[外部のリンク](https://example.com) と ![外部画像](https://example.com/x.png)

<script>alert('実行されてはいけない')</script>
[危ないリンク](javascript:alert(1))
`,
  '04_Think/壊れたYAML.md': `---
aliases: [壊れ
updated: 2026-09-01
---
# 壊れたYAML

frontmatter が壊れていても、本文は読めて、原文はそのまま残る。
`,
  '03_Work/定例/20260929_定例.md':
    '﻿---\r\ntype: minutes\r\nupdated: 2026-09-29\r\n---\r\n# 定例 2026-09-29\r\n\r\nCRLFとBOMで保存されたノート（Windowsで作った想定）。編集しても行末が変わらないことを確かめる。\r\n\r\n- 議題1\r\n- 議題2\r\n',
  '05_Knowledge/長文サンプル.md': long,
  '05_Knowledge/画像/表紙.svg': { bytes: new TextEncoder().encode(cover), type: 'image/svg+xml' },
  '01_Inbox/_uniquenote/202610020812.md': `## 読む気になる画面とは

バスの中で開いたとき、最初に目に入るものが「続き」だと、そのまま読み始められる。
一覧から探させると、探しているうちに降りる駅が来る。
`,
  '01_Inbox/_uniquenote/202610011930.md': `本質的にやるか、ハックするか

この2つは反対側にあって、どちらかに寄せすぎると崩れる（ダミーのメモ）。
`,
  '01_Inbox/_uniquenote/202609281215.md': `ランチで聞いた話：会議の準備ノートは、会議中にスマホで開けないと意味がない。リンクが本文の中に散っていると拾えない。
`,
  '00_Cockpit/thinking/読書会_準備_20261005.md': `---
type: prep
updated: 2026-10-03
---
# 読書会 10/5 の準備

> [!tip] 会議中に見る3点
> 1. 会場を決める
> 2. 次の本を三冊から一冊に
> 3. 宿題（[[余白の設計]]）の感想を一人ずつ

## 参照

- 前回：[[議事録_20261001]]
- 入口：[[1002_読書会/README|読書会]]
`,
  '.obsidian/workspace.json': '{"hidden": true}',
};

/* ——— dated from today, so the demo reads the same any day ——— */
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const compact = (offset: number) => day(offset).replace(/-/g, '');

demoVault['00_Cockpit/Tasks.md'] = `---
type: tasks
updated: ${day(0)}
---
# 📋 Tasks（ダミー）

## 🔥 アクティブ

### ⏰ 今週
- [ ] 📜 🏢 読書会の会場を決めて参加者へ連絡する 📅 ${day(2)} ➕ ${day(-6)}
\t📡 ${day(-1)} 候補は2か所。駅前の会議室は 10 名まで〔Thoth〕
\t[[読書会_準備_20261005|準備ノート]]
- [ ] 📜 💻 試作アプリを読書会メンバーに見せる 📅 ${day(5)} ➕ ${day(-3)}
\t📡 ${day(0)} ダミー Vault で動く版を公開済み〔Thoth〕
- [ ] 📜 ⏸ 佐藤さん・見積もりの返事 🛒 印刷費の見積もりを比べて発注する 📅 ${day(9)}
- [ ] 📜 🏠 年末の帰省の切符を取る 📅 ${day(40)}

### 🔘 押すだけ（関しか押せない・各5〜15分）
- [ ] 🔘 🏢 田中さんの1on1枠を取り直す（5分）
- [ ] 🔘 💻 共有ドライブの権限申請を出す・約10分
- [ ] 🔘 🛒 モールの管理画面で配送設定を確認する（15分）

## 🔁 ルーチン
- 毎朝 08:30 Slack を見る

## ⚡ Spark（衝動メニュー）
- ⚡ 読む気になる画面とは何かを問答で詰める — [[読み心地]]
- ⚡ 会議の準備ノートの型を作る

## 🧊 アイスボックス
- [ ] 📌 いつか：本棚を整理する
### ⏸ 待ち（相手ボール・自分は動けない）
- [ ] ⏸ 鈴木さん・日程の候補 🏢 読書会の次回日程を決める
`;

demoVault[`AI_Inbox/session_log/${compact(0)}.md`] = `# 📝 Session Log ${day(0)}

## 読書会の会場候補を2つに絞った〔Thoth〕

駅前の会議室（10名）と図書館の集会室（20名・予約は2週間前まで）。

## 試作アプリのダミー Vault を更新〔Technē〕

デモ用の Tasks・Job・クリップを足した。

## 印刷費の見積もりの比較表〔Thoth〕

3社のうち2社の数字がそろった。佐藤さんの返事待ち。
`;

demoVault[`00_Cockpit/jobs/done/JOB-${compact(-1)}-01_mobile-会場の比較.md`] = `---
id: JOB-${compact(-1)}-01
status: done
kind: research
actor: ACT-SEKI
created: ${day(-1)}T08:12:00+09:00
slug: mobile-会場の比較
prompt: |
  関が移動中にスマホ（vault-mobile）から頼んだ。調べて、答えと根拠をまとめる。

  ## 依頼
  読書会の会場候補を比べて
artifacts: ["00_Cockpit/thinking/読書会_準備_20261005.md"]
unknowns: 図書館の予約状況は電話でしか分からない
finished_at: ${day(-1)}T09:31:00+09:00
runner_hint: actions
---
# JOB-${compact(-1)}-01 mobile-会場の比較
`;

demoVault[`00_Cockpit/jobs/queued/JOB-${compact(0)}-01_mobile-印刷会社の候補.md`] = `---
id: JOB-${compact(0)}-01
status: queued
kind: research
actor: ACT-SEKI
created: ${day(0)}T07:50:00+09:00
slug: mobile-印刷会社の候補
prompt: |
  関が移動中にスマホ（vault-mobile）から頼んだ。調べて、答えと根拠をまとめる。

  ## 依頼
  小ロットに強い印刷会社をあと2社探して
runner_hint: actions
---
# JOB-${compact(0)}-01 mobile-印刷会社の候補
`;

demoVault[`01_Inbox/Clips/${day(-1)}T10-00-00-000Z_demo0001.md`] = `---
type: clip
tags:
  - clip
status: inbox
source: https://example.com/reading-ui
created: ${day(-1)}
captured_at: ${day(-1)}T10:00:00.000Z
atelier_clip: true
capture_note: 読書アプリの参考
---
# 長文を読ませる画面の作り方（ダミー）

https://example.com/reading-ui
`;
