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

**計画 V2.1**（AI ハッカソン 1 週間）。コードはまだありません。まず `docs/` を読んでください。V1 からの差分とレビューでの修正は `docs/CHANGELOG.md`。

| ドキュメント | 内容 |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | 何を・誰のために・なぜ作るか、スコープ、完成の定義 |
| [docs/EXPERIENCE.md](docs/EXPERIENCE.md) | 体験仕様。VR の空間モード、PC・スマホの物語モード、部屋で見る。数値と受け入れ条件 |
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
ホスティングは静的（GitHub Pages など、HTTPS 必須）。詳細は `docs/ARCHITECTURE.md`。
