# アーキテクチャ

## 1. 技術選定

| 領域 | 選定 | 理由 |
| --- | --- | --- |
| 表示 | three.js（WebXR 対応、`renderer.xr`） | WebXR・VR コントローラ・PositionalAudio が標準で揃う。カスタムシェーダと RenderTarget で流体シムが書ける |
| 流体 | 自前の GPU 流体シミュレーション（GLSL、ping-pong RenderTarget） | 絵の具が流れ渦を巻く見た目は、粒子より 2D 流体シム（移流・渦度・圧力）が近い。既存実装（WebGL-Fluid-Simulation 系）の手法を three.js 上で再実装する |
| 文字 | `troika-three-text`（SDF テキスト） | VR 内で遠近を持って浮く文字をにじみなく描ける。日本語・中国語・韓国語のフォントも読める |
| ビルド | Vite + TypeScript | 立ち上げが速く、静的出力。作品ページ `/w/<id>/` はビルド時に生成 |
| 生成パイプライン | Node スクリプト（`sharp` + 自前の k-means / Sobel） | ブラウザ側を軽くするため、重い解析はビルド時に済ませる |
| 翻訳 | Claude API（生成時のみ） | 日本語原文 + 英語を渡して 8 言語に訳す。実行時には呼ばない |
| QR | `qrcode` npm パッケージ | PNG / SVG を出せる。印刷用に SVG |
| 音 | three.js `Audio` / `PositionalAudio`（Web Audio） | ナレーションは非位置、環境音は位置付き |
| ホスティング | 静的（GitHub Pages、または Cloudflare Pages） | HTTPS が必須。サーバーは不要 |

フレームワーク（React など）は使わない。画面は「ギャラリー」「作品ページ（入口）」「空間」の 3 つしかない。

## 2. ディレクトリ構成（予定）

```
enter-the-painting/
├─ docs/                  計画・仕様
├─ works/                 作品定義（作家が触るのはここだけ）
│  └─ <id>/
│     ├─ painting.jpg     原画の撮影画像（長辺 2000px 程度）
│     ├─ work.json        タイトル、メッセージ（日本語）、上書きパラメータ
│     ├─ voice.mp3        作家ナレーション（任意）
│     └─ generated/       npm run generate の出力（flow.png、palette、space.json、訳文、qr.svg）
├─ scripts/
│  └─ generate/           画像 → 流れ場・主要色、翻訳、QR、作品ページの生成
├─ src/
│  ├─ main.ts             起動。URL から作品 id と言語を決め、space.json をロード
│  ├─ fluid/              GPU 流体シム（移流・渦度・圧力・色）。RenderTarget に描く
│  ├─ scene/              壁の絵、平面 → 球面の変形、文字の浮上、環境
│  ├─ stages/             場面の進行（S0〜S5）。距離や時間で遷移
│  ├─ input/              環境ごとの入力（vr / desktop / mobile）と自動判定
│  ├─ audio/              ナレーション・環境音・ドローン
│  ├─ i18n/               言語判定、UI 文言（10 言語）
│  └─ ui/                 ギャラリー、作品ページ、「入る」「戻る」、言語切替
├─ public/fonts/          Noto Sans（サブセット済み）
├─ index.html             ギャラリー
└─ w/<id>/index.html      作品ページ（ビルド時に生成。OGP 付き）
```

## 3. 画像 → 空間の生成パイプライン（`npm run generate -- <id>`）

入力：`works/<id>/painting.jpg` と `work.json`。出力：`works/<id>/generated/`。

1. **前処理**：長辺 2048px に縮小（流体の色テクスチャ用）。入口表示用に 1024px の JPEG も作る
2. **主要色**：k-means で主要色 6 個。面積順に並べ、最も明るい色を文字色、面積最大の色を球面の裏側（絵が無かった方向）の基調色にする
3. **筆致の流れ場**：Sobel で勾配を取り、構造テンソルを平滑化して各画素の主方向を求める。方向と強さを `flow.png`（R=cos、G=sin、B=強さ）に書き出す。S1 のかすかな流れと、S2 で流体が流れ出す初期速度に使う
4. **動きのパラメータ**：画像のコントラスト・エッジ密度から、流体の渦度の強さ・流れの速さの初期値を決める。穏やかな絵はゆっくり、激しい絵は速く
5. **メッセージ**：`work.json` の `messages`（日本語、1 文ずつの配列）を取り、`voice.mp3` があれば各文の開始時刻を `captions[].at` に合わせる（初期値は等間隔。手で直す）
6. **翻訳**：`messages` を英語（作家が確認）と残り 8 言語に Claude API で訳す。既に訳がある文は再翻訳しない（`translations.json` にキャッシュ）。API キーが無ければ日本語と英語（手書きがあれば）のみ
7. **space.json**：主要色、流れ場、動き、音、10 言語のメッセージをまとめる。実行時はこれだけ読む
8. **作品ページと QR**：`w/<id>/index.html`（タイトル・絵・OGP）を生成。`BASE_URL/w/<id>/` の QR を `qr.svg` / `qr.png` に。作品カード印刷用 `card.svg` も出す

自動はたたき台。`work.json` の `overrides` で流体の速さ・渦・半径などを手で詰められるようにする。

## 4. 流体と変形（実行時）

- **流体シム**：速度場 256×256、色（染料）1024×1024 の 2 枚の RenderTarget を ping-pong。毎フレーム、移流 → 渦度の補強 → 発散計算 → 圧力解法（Jacobi 20 回）→ 速度の補正 → 色の移流。拡散は 0、色の減衰は 0（濁らせない・薄れさせない）
- **初期状態**：色 = 絵の画像、速度 = `flow.png` × 強さ。S1 では速度を 1〜2px 相当に抑え、距離が縮むほど強める。S2 で本来の強さにする
- **視線の影響**：S4 で、視線方向に対応する球面上の点に毎フレーム弱い力（splat）を加える。流れが視線に引き寄せられる
- **平面 → 球面**：1 枚のメッシュ（分割 128×64）を用意し、頂点シェーダで `t`（0=平面、1=球面）に応じて位置を補間する。UV は絵の範囲を球面の前方 90°×70° に写し、残りの球面（裏側）は基調色のグラデーション + 流体の流れ込みで埋める。カメラは動かさない
- **文字**：troika の Text を 1 つ。視線方向の 8m 先に置き、6 秒で 2m まで前進、滞在、3 秒で不透明度 0 に。前進中は視線の変化にゆっくり追従（毎秒 30%）
- **性能目安**：Quest で 72fps。落ちたら色を 512×512、圧力の反復を 12 回に下げる。段階は `space.json` の `quality` で指定でき、実行時に fps を見て自動で 1 段下げる

## 5. 場面の進行（`stages/`）

状態機械。`S0 → S1 → S2 → S3 → S4 → S5 → S0`。遷移条件と数値は `docs/EXPERIENCE.md` に従う。各場面は `enter / update(dt) / exit` を持ち、Scene・流体・音・文字に指示を出すだけで、描画の実装は持たない。

## 6. 3 環境の入力と表示の切り替え

起動時に判定し、`InputMode` を 1 つ選ぶ。すべて同じ `Scene`、同じ流体、同じ文字を使い、カメラの動かし方と接近の操作だけ差し替える。

| モード | 判定 | 見回し | 接近 | 戻る | 備考 |
| --- | --- | --- | --- | --- | --- |
| `vr` | `navigator.xr.isSessionSupported('immersive-vr')` が true | ヘッドセット | 歩く / スティック 0.8m/s | B / Y 長押し | three.js の `VRButton`。セッション中は `renderer.xr` がカメラを握る |
| `mobile` | タッチ端末で `DeviceOrientationEvent` がある | 端末の向き | 長押し 1.0m/s | 右上ボタン | iOS は「入る」ボタン内で `requestPermission()`。three.js 本体に `DeviceOrientationControls` は無いので小さな自前実装（約 60 行）を置く |
| `desktop` | それ以外 | `PointerLockControls`（マウス） | W / ↑ 1.2m/s | Esc | ポインターロック拒否時はドラッグで見回す |

全モード共通：15 秒無操作で自動接近 0.3m/s。VR 対応端末でもまず 2D で表示し、「VR で入る」で immersive-vr に移る。

## 7. ルーティング、ギャラリー、QR

- ギャラリー：`/`。5 作品を実物の寸法比で並べる。選ぶと作品ページへ
- 作品ページ：`/w/<id>/`。ビルド時に生成する静的 HTML（タイトル・絵・OGP メタ）。同じ JS バンドルを読み、`<meta name="work" content="<id>">` から作品を決める
- 言語：`navigator.languages` から 10 言語のうち最初に一致するものを選ぶ。無ければ英語。`?lang=ja` で固定。切り替えは `localStorage` に覚える
- QR の中身は `BASE_URL/w/<id>/`。`BASE_URL` は `.env` で設定

## 8. 言語（`i18n/`）

- メッセージの訳は `space.json` に 10 言語分を埋め込む（1 作品 10 文 × 10 言語でも数 KB）
- UI 文言（「入る」「戻る」「VR で入る」「他の作品」など 15 個程度）は `src/i18n/ui.json` に 10 言語分
- フォントは言語ごとに 1 つだけ読む：`ja` → Noto Sans JP、`zh-Hans` → SC、`zh-Hant` → TC、`ko` → KR、それ以外 → Noto Sans。メッセージと UI 文言に使う文字だけでサブセット化（`pyftsubset` または `subset-font`）して各 300KB 以下にする
- 言語を切り替えたら、文字の Text と UI だけ差し替える。流体・音はそのまま

## 9. 音

- **ナレーション**：`voice.mp3`（日本語）。S3 完了で再生。非位置（`THREE.Audio`）。文字の出現を `captions[].at` に揃える
- **環境音**：プリセット（`calm / wind / water / drone`）。S1 では絵の位置の `PositionalAudio`、S3 以降は全方向
- **ドローン**：S2 で立ち上がり S3 で最大、S4 で落ち着く低い持続音
- すべて「入る」ボタンのクリック内で `AudioContext.resume()` してから開始する

## 10. 開発とデプロイ

- `npm run dev -- --host` + basic-ssl で LAN の HTTPS。Quest / スマホから `https://<PCのIP>:5173` で確認
- `main` への push で GitHub Pages にビルド・配置（Actions）。実機テストは本番 URL でも行う
- 生成物（`works/*/generated/`）はコミットする（1 作品あたり数 MB）。翻訳のキャッシュ `translations.json` もコミットして API 呼び出しを繰り返さない
