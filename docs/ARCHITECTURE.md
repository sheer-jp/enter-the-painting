# アーキテクチャ

## 1. 技術選定

| 領域 | 選定 | 理由 |
| --- | --- | --- |
| 表示 | three.js（WebXR 対応、`renderer.xr`） | WebXR・VR コントローラ・PositionalAudio が標準で揃う。A-Frame より細かい演出を書きやすい |
| ビルド | Vite + TypeScript | 立ち上げが速く、静的出力。`@vitejs/plugin-basic-ssl` で LAN 内 HTTPS |
| 生成パイプライン | Node スクリプト（`sharp` + 自前の k-means / Sobel） | ブラウザ側を軽くするため、重い解析はビルド時に済ませる |
| QR | `qrcode` npm パッケージ | PNG / SVG を出せる。印刷用に SVG |
| 音 | three.js `Audio` / `PositionalAudio`（Web Audio） | ナレーションは非位置、環境音は位置付き |
| ホスティング | 静的（GitHub Pages、または Vercel / Cloudflare Pages） | HTTPS が必須。サーバーは不要 |
| LLM（任意） | Claude API（作家メモ → 字幕・プリセット提案） | 生成時のみ。実行時は呼ばない |

フレームワーク（React など）は使わない。画面は「入口」「空間」「戻る」の 3 状態しかない。

## 2. ディレクトリ構成（予定）

```
enter-the-painting/
├─ docs/                  計画・仕様
├─ works/                 作品定義（作家が触るのはここだけ）
│  └─ <id>/
│     ├─ painting.jpg     原画の撮影画像（長辺 2000px 程度）
│     ├─ work.json        タイトル、メモ、上書きパラメータ
│     ├─ voice.mp3        作家ナレーション（任意）
│     └─ generated/       npm run generate の出力（層 PNG、flow.png、space.json、qr.svg）
├─ scripts/
│  └─ generate/           画像 → 空間パラメータ、QR 生成
├─ src/
│  ├─ main.ts             起動、URL の ?w=<id> を読み作品をロード
│  ├─ scene/              空間の組み立て（層、背景ドーム、粒子、ダイブ演出）
│  ├─ input/              環境ごとの入力（vr / desktop / mobile）と自動判定
│  ├─ audio/              ナレーション・環境音
│  └─ ui/                 入口画面、「入る」ボタン、字幕
├─ public/                静的ファイル（works/*/generated をここに同期、または直接参照）
└─ index.html
```

## 3. 画像 → 空間の生成パイプライン（`npm run generate -- <id>`）

入力：`works/<id>/painting.jpg` と `work.json`。出力：`works/<id>/generated/`。

1. **前処理**：長辺 2048px に縮小。色は sRGB のまま
2. **色の層の抽出**：k-means で主要色 K 個（既定 6、`work.json` で 4〜8 に変更可）にクラスタリング。各画素をクラスタに割り当て、クラスタごとにマスクを作る。マスクは少しぼかして（feather）境界を柔らかくし、透明 PNG `layer_<k>.png` として書き出す
3. **奥行きの割り当て**：各クラスタに奥行き（視点からの距離）を割り当てる。既定は「暗く彩度が低い色ほど遠く、明るく彩度が高い色ほど近く」。面積が最大の色は背景ドームの色にも使う。`work.json` で層ごとに上書き可能
4. **筆の流れ場**：Sobel で勾配を取り、構造テンソルを平滑化して各画素の主方向を求める。方向と強さを `flow.png`（R=cos、G=sin、B=強さ）として書き出す。実行時に粒子や筆跡ストロークがこの場に沿って流れる
5. **動きのパラメータ**：画像全体のコントラスト・エッジ密度から「動きの速さ」「揺らぎの大きさ」の初期値を決める。穏やかな絵はゆっくり、激しい絵は速く
6. **space.json**：層の一覧（テクスチャ、奥行き、不透明度、動き）、背景色、流れ場、音の設定、字幕テキストをまとめる。実行時はこれだけ読む
7. **QR**：`BASE_URL/?w=<id>` を `qr.svg` と `qr.png` に。作品カード印刷用にタイトル付きの `card.svg` も出す
8. **（任意）Claude API**：`work.json` の作家メモから、字幕用の短い文（3〜5 文）、環境音プリセット（`calm / wind / water / drone`）、動きの速さの提案を得て `space.json` に反映。API キーが無ければスキップし、既定値を使う

自動はたたき台。`work.json` の `overrides` で層数・奥行き・速さを手で詰められるようにする。

## 4. 空間の組み立て（実行時）

- 視点は原点。**層は視点を取り囲む曲面**（円筒の一部、または半球）に貼る。奥の層ほど半径が大きく、少し大きく拡大して視差を作る
- 一番奥に**背景ドーム**（主要色のグラデーション）。外側に抜けないようにする
- 層ごとに、流れ場に沿った**ゆっくりした揺らぎ**（UV のオフセット、頂点のうねり）
- **粒子 / 筆跡ストローク**：流れ場に沿って漂う。視線方向（カメラの forward）に向かって少し引き寄せられ、「筆の流れが追いかけてくる」感じを出す
- **ダイブ演出**：入口では原画を 1 枚の平面として視界いっぱいに表示。「入る」で各層が奥行きに応じて分離しながら曲面に変形し、カメラが中心に収まる。5〜8 秒。酔いを避けるため回転はさせない
- 性能目安：Quest で 72fps。テクスチャ 2048px 以下、層 8 枚以下、粒子 2,000 個以下

## 5. 3 環境の入力と表示の切り替え

起動時に判定し、`InputMode` を 1 つ選ぶ。すべて同じ `Scene` を使い、カメラの動かし方だけ差し替える。

| モード | 判定 | 見回し | 移動 | 備考 |
| --- | --- | --- | --- | --- |
| `vr` | `navigator.xr.isSessionSupported('immersive-vr')` が true | ヘッドセット | コントローラのスティックで前後（任意） | three.js の `VRButton`。セッション中は `renderer.xr` がカメラを握る |
| `mobile` | タッチ端末で `DeviceOrientationEvent` がある | 端末の向き | なし（指のドラッグで補助回転） | iOS は「入る」ボタン内で `requestPermission()`。three.js 本体から `DeviceOrientationControls` は削除済みなので、小さな自前実装（約 60 行）を置く |
| `desktop` | それ以外 | `PointerLockControls`（マウス） | WASD / 矢印 | ポインターロック拒否時はドラッグで見回す |

VR 対応端末でもまず 2D（desktop / mobile）で表示し、「VR で入る」ボタンで immersive-vr に移る。

## 6. ルーティングと QR

- URL は `https://<host>/?w=<id>`。ハッシュではなくクエリにして静的ホスティングで素直に動かす
- `?w=` が無いときはギャラリー（作品一覧）か、1 作品ならその作品へ
- QR の中身はこの URL そのもの。`BASE_URL` は `.env` で設定

## 7. 音

- **ナレーション**：`voice.mp3`。ダイブ完了後に再生。非位置（`THREE.Audio`）。字幕を下部に出す
- **環境音**：プリセット（`calm / wind / water / drone`）から選び、`PositionalAudio` を空間の奥に数点置く
- どちらも「入る」ボタンのクリック内で `AudioContext.resume()` してから開始する

## 8. 開発とデプロイ

- `npm run dev -- --host` + basic-ssl で LAN の HTTPS。Quest / スマホから `https://<PCのIP>:5173` で確認
- `main` への push で GitHub Pages にビルド・配置（Actions）。実機テストは本番 URL でも行う
- 生成物（`works/*/generated/`）は小さければコミットする。大きくなったら Actions 内で生成に切り替える
