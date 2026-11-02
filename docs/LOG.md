# 作業ログ

毎回の作業の終わりに 1 エントリ追記する（新しい日付が上）。`/log` で追記、`/close` で「テスト → レビュー → ログ → コミット → push」をまとめて行う。

書く項目は 4 つだけ。**やった / 決めた / 困った・学んだ / 次にやる**。

---

## 2026-11-02（Day 0）

**やった**
- リポジトリ作成、計画ドキュメント一式（PLAN / ARCHITECTURE / WORK_FORMAT / SCHEDULE / RISKS）
- GitHub に public で公開：https://github.com/sheer-jp/enter-the-painting
- 作業ルーチン（ログ・レビュー・テスト）と `/log` `/close` `/dig` スキルを追加
- ユーザー理解の深掘り資料（`docs/USERS.md`）を追加

**決めた**
- 体験の核を確定：近づくと絵が流体になって全身を包む（S2〜S3）、奥から文字が浮く（S4）、文字は母語で自動選択（10 言語）。`docs/EXPERIENCE.md` に場面ごとの数値と受け入れ条件を書いた
- MVP は 5 作品。入口は会場の QR とオンラインギャラリーの 2 つ。作品ごとに固定ページ `/w/<id>/`
- 言語は選ばせず端末の言語で決める。理由は作家の言葉「母語でないと心にスッと入ってこない」
- NFC タグは将来項目。タグに同じ URL を書くだけなのでアプリ側の追加実装は不要
- three.js + Vite + TypeScript。流体は自前の GPU シム、文字は troika-three-text。UI フレームワークは入れない
- 画像解析はビルド時（`npm run generate`）に寄せ、実行時は `space.json` だけ読む
- 1 作品を VR まで通してから作品数を増やす。最低ラインは Day 3「Quest で入れる」

**困った・学んだ**
- クラウドセッションから GitHub の新規リポジトリ作成はできない（セッションに紐づく repo 以外の API が拒否される）。repo は github.com/new で手動作成し、push は Claude が行う
- 自動許可モードでは外部アップロード系のコマンドが止まる。確認が必要な操作は「Accept edits」モードに切り替える

**次にやる**
- Day 1：Vite + three.js の足場、`generate` v0（k-means の層抽出 → space.json）、作品 1 点の撮影
- `docs/USERS.md` の仮説を本人の言葉で埋める（10 分）
