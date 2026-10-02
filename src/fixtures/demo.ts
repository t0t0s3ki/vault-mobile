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
  '.obsidian/workspace.json': '{"hidden": true}',
};
