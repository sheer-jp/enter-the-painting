# enter-the-painting（仮称：抽象画の中に入りこめる・デジタルギャラリー）

小さな抽象画の持ち主が QR を読む（またはオンラインギャラリーで選ぶ）と、その絵の世界の中に入れる Web アプリ。
**手元の絵に近づくと、絵が流体になって自分の全部を包む。奥から文字がふんわり浮いてきて、母語でメッセージを読める。**
VR ヘッドセット・パソコン・スマホのどれでも、同じ絵の空間に入れる。

- アプリのインストール不要（ブラウザで動く WebXR）
- 作品 1 点につき「画像 + メッセージ」を置くだけで、流体・10 言語の文字・作品ページ・QR が自動生成される
- 空間の中に作家の声（制作の背景）と音を置く
- MVP は 5 作品。会場の QR からも、オンラインギャラリーからも、同じ作品ページに着く

## 状態

**計画フェーズ**（AI ハッカソン 1 週間）。コードはまだありません。まず `docs/` を読んでください。

| ドキュメント | 内容 |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | 何を・誰のために・なぜ作るか、スコープ、完成の定義 |
| [docs/EXPERIENCE.md](docs/EXPERIENCE.md) | 体験仕様。場面ごとに見える・聞こえる・数値・受け入れ条件 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 技術選定、構成、流体と変形、生成パイプライン、3 環境の入力切替、言語 |
| [docs/WORK_FORMAT.md](docs/WORK_FORMAT.md) | 作品定義ファイル（`works/<id>/work.json`）の仕様 |
| [docs/SCHEDULE.md](docs/SCHEDULE.md) | 7 日間の日程とマイルストーン |
| [docs/RISKS.md](docs/RISKS.md) | リスクと逃げ道 |
| [docs/USERS.md](docs/USERS.md) | 誰のどの悩みに効くか（登場人物、仮説、聞き方、記録） |
| [docs/ROUTINE.md](docs/ROUTINE.md) | 作業ルーチン（テスト → レビュー → ログ → コミット） |
| [docs/LOG.md](docs/LOG.md) | 作業ログ |
| [CLAUDE.md](CLAUDE.md) | Claude Code 向けの作業ルール |

## 予定している技術

Vite + TypeScript + three.js（WebXR）。生成パイプラインは Node スクリプト。
ホスティングは静的（GitHub Pages など、HTTPS 必須）。詳細は `docs/ARCHITECTURE.md`。
