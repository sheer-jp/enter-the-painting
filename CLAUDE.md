# CLAUDE.md

抽象画の中に入れる WebXR ギャラリー。AI ハッカソン（1 週間）の試作。

## まず読む（毎回、この 3 つだけ）

- `docs/LOG.md`：作業ログ。先頭の「次にやる」
- `docs/TASKS.md`：当日のタスク。ID を挙げて進める
- `docs/EXPERIENCE.md`：体験仕様。VR の空間モード（S1〜S5）、PC・スマホの物語モード（T0〜T5）、部屋で見る。迷ったらここ

## 必要なときに読む

- 実装するとき：`docs/ARCHITECTURE.md`（技術選定、モジュールの境界。ここに無い技術を足すときは理由を docs に書く）、`docs/REQUIREMENTS.md`（要件 ID と受け入れ条件）、`docs/WORK_FORMAT.md`（作品定義ファイル）
- 技術的に詰まったとき：`docs/SPIKES.md`（検証と逃げ道、記録欄）、`docs/RISKS.md`
- 体験や機能を決めるとき：`docs/USERS.md`（誰のどの悩み）、`docs/JOURNEY.md`（離脱点と交差点）、`docs/DECISIONS.md`（決定と未決定）
- 全体を見直すとき：`docs/PLAN.md`、`docs/SCHEDULE.md`、`docs/CHANGELOG.md`
- 作家向け：`docs/CONTENT.md`（撮影、メッセージ、声、部屋のイメージ）、`docs/PITCH.md`（提出）
- 作業の型：`docs/ROUTINE.md`

## ルーチン（毎回）

- 作業の最初に `docs/LOG.md` の「次にやる」と `docs/TASKS.md` の当日分を読む。タスク ID を挙げて進める
- 実装は `docs/ARCHITECTURE.md` の「モジュールの境界」のインターフェースに従う。変えるなら docs を先に変える
- 体験や機能を決めるときは `/dig` で「誰のどの悩みに効くか」を確かめてから作る
- 作業の最後は必ず `/close`（テスト → `/code-review` → `/log` → コミット → push）。飛ばした手順はログに理由を書く
- 実機チェック（PC / スマホ / Quest）は毎日 1 回。結果は `docs/LOG.md` と `docs/USERS.md` の記録欄に書く

プロジェクトのスキル：`/log`（ログ追記）、`/close`（終わりのルーチン）、`/dig`（悩みの深掘り）。`.claude/skills/` にある。

## 作業ルール

- **作家の絵を変えない**。流体にして流しはするが、画像生成 AI で描き足さない。絵の画像を生成モデルに入れない（部屋の画像の生成は可。絵は実物の写真を射影で合成）。拡散 0、色の減衰 0（濁らせない）
- 実行時は `works/<id>/generated/space.json` だけを読む。解析と翻訳はすべて `npm run generate` に寄せ、実行時に外部 API を呼ばない
- モードは 2 つ。VR は空間（`space/`）、PC・スマホは物語（`story/`）。流体（`fluid/`）・文字（`text/`）・音（`audio/`）は両モードから同じ API で使い、モードで分岐させない
- 場面の遷移（S0〜S5、T0〜T5）はそれぞれの状態機械だけが決める。数値は `docs/EXPERIENCE.md` から取り、変えたら docs も変える
- 部屋のイメージと小さな物語には「AI 生成のイメージ」「物語」と明記し、実在の部屋・出来事と誤認させない
- 音声の開始・ジャイロ許可・XR セッション開始は、必ずユーザー操作（「入る」ボタン）のハンドラ内で行う
- 文字は閲覧者の母語。言語は端末の言語で自動判定し、選ばせない（切り替えはできる）
- 性能の上限：流体の領域は等距離円筒 2:1、品質 high で色 2048×1024 / 速度 512×256、圧力反復 20 回、Quest で 72fps。超えるなら相談
- 数値拡散の対策（MacCormack + 原画への回帰）を外さない。3 分後も構図が残ること
- 声は `<audio>` 要素。消音でも文字だけで成立させる
- フォールバック（静止画モード）を壊さない。`prefers-reduced-motion` を尊重する
- VR のカメラは S2〜S5 で動かさない（酔い対策）。絵の方が動く
- 作品ページは JS を待たずに絵が出る。ページ用 JS は gzip 20KB 以下、体験バンドルは「入る」後に `import()` で gzip 300KB 以下
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

2026-11-02：計画 V2.1（`docs/CHANGELOG.md`）。独立レビューの指摘を反映済み。Day 0 の未決定 U-12〜U-14（落とすもの、独自ドメイン、VR を誰が使うか）は作家の判断待ち。コードは未着手。リモートは https://github.com/sheer-jp/enter-the-painting（public）。
