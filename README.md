# enter-the-painting（仮称：抽象画の中に入りこめる・デジタルギャラリー）

小さな抽象画の持ち主が QR を読む（またはオンラインギャラリーで選ぶ）と、その絵の世界の中に入れる Web アプリ。

- **VR**：絵にギュンと近づくと、シュワシュワと溶けて、気づいたら自分の全体が絵の流体に包まれている。声と文字が流れてくる
- **PC・スマホ**：絵が画面いっぱいになり、流体のアニメーションが流れる。作家の声と文字で、物語のように語られる
- **作品ページ**：家やホテルに置かれたイメージ（部屋は AI、絵は実物の写真、寸法は目安）と、その絵のある日々を描いた小さな物語

課題は「絵の『世界』が伝わらない場面が 3 つある。会場の小さな絵、オンラインの絵、買ったあとの絵」。

- アプリのインストール不要（ブラウザで動く WebXR）
- 作品 1 点につき「画像 + メッセージ」を置くだけで、流体・10 言語の文字・部屋のイメージ・作品ページ・QR が自動生成される
- 文字は閲覧者の母語で出る。声は作家の日本語のみ
- MVP は 5 作品（目標。3 作品で通してから広げる）。会場の QR からも、オンラインギャラリーからも、同じ作品ページに着く

## 権利

コードは MIT（`LICENSE`）。`works/` の絵・声と `rooms/` の部屋画像は作家の著作物で、権利を留保します。第三者のフォントと手法の出典は `THIRD_PARTY.md`。

## 状態

**実装中**（AI ハッカソン 1 週間、Day 1〜2 相当まで）。計画は `docs/`、変更履歴は `docs/CHANGELOG.md`、作業ログは `docs/LOG.md`。

11-06：入口を作り直し中（`docs/ENTRANCE.md`）。オンラインは `/` の受付（キャラクターとの会話 → おすすめの 1 点）から白い壁のギャラリー `/gallery/`、作品ページへ。会場の QR は作品ページに直接。置き場は Cloudflare Pages（いまは https://enter-the-painting.pages.dev/ ）。

```bash
npm install
npm run generate     # works/<id>/ から流れ場・主要色・翻訳・部屋の合成・QR・作品ページを生成
BASE_URL=https://enter-the-painting.pages.dev npm run generate   # 配置する前はこちら（QR・OGP・SNS カードの URL を配置先に）
npm run dev          # https://localhost:5173/w/harmoney/ （LAN の HTTPS。スマホ / Quest から確認）
npm test && npm run build && npm run smoke
CLOUDFLARE_ACCOUNT_ID=<アカウント ID> npx wrangler pages deploy   # generate と build のあと。Cloudflare Pages に配置（サイト + functions/）
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name enter-the-painting   # 受付の API キー（合言葉を使うなら PASSPHRASE も）
```

動いているもの：生成パイプライン、GPU 流体、物語モード（PC・スマホ）、静止画フォールバック、作品ページとギャラリー、10 言語の UI、Playwright のスモーク。VR 空間モードは実装済みだが Quest で未確認。
11-06：Cloudflare Pages（https://enter-the-painting.pages.dev/ ）に配置済み。Pages Functions `/api/recommend` で Claude API と会話し、ツール `recommend_work` で 1 点が返ることを確認。受付画面（`/`）とギャラリー空間（`/gallery/`）は作業中（`docs/TASKS.md` の E-1、E-2）。

| ドキュメント | 内容 |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | 何を・誰のために・なぜ作るか、スコープ、完成の定義 |
| [docs/EXPERIENCE.md](docs/EXPERIENCE.md) | 体験仕様。VR の空間モード、PC・スマホの物語モード、部屋で見る。数値と受け入れ条件 |
| [docs/ENTRANCE.md](docs/ENTRANCE.md) | 入口の設計（正）。受付の会話 → ギャラリー空間 → 絵の中へ。キャラクター、スマホ、配線、合言葉、受け入れ条件 |
| [docs/WORKS_VOICE.md](docs/WORKS_VOICE.md) | 作品ごとの作家の語り（11-06 口述、原典）。`work.json` の messages / moods の元 |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 要件定義。ID、課題・人・場面との対応、優先度、受け入れ条件 |
| [docs/JOURNEY.md](docs/JOURNEY.md) | ユーザージャーニー。来場者・オンラインの人・持ち主・海外の人・作家の 5 つの旅 |
| [docs/TASKS.md](docs/TASKS.md) | タスク分解。日ごとに 2〜4 時間の単位、誰が、依存、完了の条件 |
| [docs/SPIKES.md](docs/SPIKES.md) | 技術検証。最初に潰す不安 8 つと逃げ道 |
| [docs/CONTENT.md](docs/CONTENT.md) | コンテンツ計画。作品の選び方、撮影、メッセージ、声、部屋のイメージ、UI 文言、音 |
| [docs/PITCH.md](docs/PITCH.md) | 提出と見せ方。ピッチ構成、デモ動画の絵コンテ、想定質問 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 決めたこと（理由つき）と未決定（期限つき） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 技術選定、構成、流体と変形、生成パイプライン、3 環境の入力切替、言語 |
| [docs/WORK_FORMAT.md](docs/WORK_FORMAT.md) | 作品定義ファイル（`works/<id>/work.json`）の仕様 |
| [docs/SCHEDULE.md](docs/SCHEDULE.md) | 7 日間の日程とマイルストーン |
| [docs/RISKS.md](docs/RISKS.md) | リスクと逃げ道 |
| [docs/USERS.md](docs/USERS.md) | 誰のどの悩みに効くか（登場人物、仮説、聞き方、記録） |
| [docs/ROUTINE.md](docs/ROUTINE.md) | 作業ルーチン（テスト → レビュー → ログ → コミット） |
| [docs/LOG.md](docs/LOG.md) | 作業ログ |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 計画の変更履歴（V1 → V2） |
| [CLAUDE.md](CLAUDE.md) | Claude Code 向けの作業ルール |

## 予定している技術

Vite + TypeScript + three.js（WebXR）。生成パイプラインは Node スクリプト。
ホスティングは静的（GitHub Pages など、HTTPS 必須）。詳細は `docs/ARCHITECTURE.md`。（11-06 に変更：Cloudflare Pages（サイト + Pages Functions）。GitHub Pages は使わない）
