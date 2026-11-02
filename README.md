# enter-the-painting（仮称：抽象画の中に入りこめる・デジタルギャラリー）

小さな抽象画の持ち主が QR を読む（またはオンラインギャラリーで選ぶ）と、その絵の世界の中に入れる Web アプリ。

- **VR**：絵にギュンと近づくと、シュワシュワと溶けて、気づいたら自分の全体が絵の流体に包まれている。声と文字が流れてくる
- **PC・スマホ**：絵が画面いっぱいになり、流体のアニメーションが流れる。作家の声と文字で、物語のように語られる
- **作品ページ**：家やホテルに置かれたイメージ（部屋は AI、絵は実物を実寸で合成）と、その絵のある日々を描いた小さな物語

課題は「絵の『世界』が伝わらない場面が 3 つある。会場の小さな絵、オンラインの絵、買ったあとの絵」。

- アプリのインストール不要（ブラウザで動く WebXR）
- 作品 1 点につき「画像 + メッセージ」を置くだけで、流体・10 言語の文字・部屋のイメージ・作品ページ・QR が自動生成される
- 文字は閲覧者の母語で出る。声は作家の日本語のみ
- MVP は 5 作品。会場の QR からも、オンラインギャラリーからも、同じ作品ページに着く

## 状態

**計画 V2**（AI ハッカソン 1 週間）。コードはまだありません。まず `docs/` を読んでください。V1 からの差分は `docs/CHANGELOG.md`。

| ドキュメント | 内容 |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | 何を・誰のために・なぜ作るか、スコープ、完成の定義 |
| [docs/EXPERIENCE.md](docs/EXPERIENCE.md) | 体験仕様。VR の空間モード、PC・スマホの物語モード、部屋で見る。数値と受け入れ条件 |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 要件定義。ID、課題・人・場面との対応、優先度、受け入れ条件 |
| [docs/JOURNEY.md](docs/JOURNEY.md) | ユーザージャーニー。来場者・オンラインの人・持ち主・海外の人・作家の 5 つの旅 |
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
