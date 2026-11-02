# CLAUDE.md

抽象画の中に入れる WebXR ギャラリー。AI ハッカソン（1 週間）の試作。

## まず読む

- `docs/PLAN.md`：何を・なぜ。スコープと完成の定義
- `docs/ARCHITECTURE.md`：技術選定と構成。ここに無い技術を足すときは理由を docs に書く
- `docs/WORK_FORMAT.md`：作品定義ファイルの仕様。作家が触るのは `works/<id>/` だけ
- `docs/SCHEDULE.md`：日程。遅れたら「遅れたときの優先順位」に従う
- `docs/USERS.md`：誰のどの悩みに効くか。体験や機能を決める前に見る
- `docs/ROUTINE.md`：作業の始め方・終わり方、レビューの観点、テストの層
- `docs/LOG.md`：作業ログ。作業の最初に「次にやる」を読む

## ルーチン（毎回）

- 作業の最初に `docs/LOG.md` の「次にやる」を読む
- 体験や機能を決めるときは `/dig` で「誰のどの悩みに効くか」を確かめてから作る
- 作業の最後は必ず `/close`（テスト → `/code-review` → `/log` → コミット → push）。飛ばした手順はログに理由を書く
- 実機チェック（PC / スマホ / Quest）は毎日 1 回。結果は `docs/LOG.md` と `docs/USERS.md` の記録欄に書く

プロジェクトのスキル：`/log`（ログ追記）、`/close`（終わりのルーチン）、`/dig`（悩みの深掘り）。`.claude/skills/` にある。

## 作業ルール

- **作家の絵を変えない**。層の抽出・ぼかし・配置はするが、画像生成 AI で描き足さない
- 実行時は `works/<id>/generated/space.json` だけを読む。解析はすべて `npm run generate` に寄せる
- 3 環境（vr / desktop / mobile）は同じ Scene を使い、入力だけ差し替える。モード別に Scene を分岐させない
- 音声の開始・ジャイロ許可・XR セッション開始は、必ずユーザー操作（「入る」ボタン）のハンドラ内で行う
- 性能の上限：テクスチャ 2048px、層 8 枚、粒子 2,000 個。超えるなら相談
- 依存は最小に。React などの UI フレームワークは入れない
- コードのコメントと UI 文言は日本語。識別子は英語

## コマンド（実装後に更新する）

```bash
npm install
npm run dev -- --host        # LAN の HTTPS で開発。スマホ / Quest から確認
npm run generate -- <id>     # works/<id>/ から空間と QR を生成
npm run build                # 静的ビルド（dist/）
```

## 状態

2026-11-02：計画フェーズ。コードは未着手。リモートは https://github.com/sheer-jp/enter-the-painting（public）。
