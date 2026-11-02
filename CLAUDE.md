# CLAUDE.md

抽象画の中に入れる WebXR ギャラリー。AI ハッカソン（1 週間）の試作。

## まず読む

- `docs/PLAN.md`：何を・なぜ。スコープと完成の定義
- `docs/ARCHITECTURE.md`：技術選定と構成。ここに無い技術を足すときは理由を docs に書く
- `docs/WORK_FORMAT.md`：作品定義ファイルの仕様。作家が触るのは `works/<id>/` だけ
- `docs/SCHEDULE.md`：日程。遅れたら「遅れたときの優先順位」に従う

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
