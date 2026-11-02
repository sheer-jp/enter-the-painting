# 作品定義ファイル（`works/<id>/work.json`）

作家が触るのはこのファイルと画像・音声だけ。他はすべて `npm run generate -- <id>` が作る。

## 置くもの

```
works/<id>/
├─ painting.jpg   必須。原画の撮影画像。長辺 2000px 程度、正対して撮る
├─ work.json      必須。下記
└─ voice.mp3      任意。作家のナレーション（1〜3 分）
```

`<id>` は URL と QR に使う。英小文字・数字・ハイフンのみ（例：`blue-tide-2025`）。

## work.json

```jsonc
{
  "id": "blue-tide-2025",
  "title": "青い潮",
  "year": 2025,
  "size_cm": [18, 14],                    // 実物の寸法（幅, 高さ）。入口表示の比率に使う
  "medium": "キャンバスに油彩",

  // 作家メモ。字幕と（任意で）Claude API の提案に使う。3〜10 行程度
  "note": "海辺の町で描いた。朝の光が水面で割れるときの、青が緑に変わる一瞬。…",

  // 音
  "audio": {
    "voice": "voice.mp3",                 // 無ければ字幕のみ
    "ambient": "water"                    // calm | wind | water | drone | none。省略時は自動
  },

  // 自動生成の上書き。すべて任意。無ければ自動値
  "overrides": {
    "layers": 6,                          // 色の層の数 4〜8
    "depth": [1.0, 0.8, 0.6, 0.45, 0.3, 0.2],  // 層ごとの奥行き（0=手前,1=最奥）。要素数は layers と同じ
    "motion_speed": 0.4,                  // 0〜1。揺らぎと粒子の速さ
    "motion_amount": 0.5,                 // 0〜1。揺らぎの大きさ
    "background": "#0b1a2a",              // 背景ドームの基調色
    "feather_px": 24                      // 層の境界のぼかし幅
  }
}
```

## 生成されるもの（`works/<id>/generated/`）

| ファイル | 内容 |
| --- | --- |
| `layer_0.png` … `layer_N.png` | 色の層（透明 PNG、2048px 以下） |
| `flow.png` | 筆の流れ場（R=cos θ、G=sin θ、B=強さ） |
| `space.json` | 実行時に読む唯一の定義。層・奥行き・動き・背景・音・字幕 |
| `qr.svg` / `qr.png` | `BASE_URL/?w=<id>` の QR |
| `card.svg` | 作品カード印刷用（タイトル、寸法、QR） |

### space.json（実行時が読む）

```jsonc
{
  "id": "blue-tide-2025",
  "title": "青い潮",
  "painting": "painting.jpg",
  "aspect": 1.2857,
  "background": { "top": "#0b1a2a", "bottom": "#1c3550" },
  "layers": [
    { "texture": "layer_0.png", "depth": 1.0, "opacity": 1.0, "color": "#0b1a2a", "area": 0.41 },
    { "texture": "layer_1.png", "depth": 0.8, "opacity": 0.95, "color": "#1f5f7a", "area": 0.22 }
  ],
  "flow": { "texture": "flow.png", "speed": 0.4, "amount": 0.5 },
  "audio": { "voice": "voice.mp3", "ambient": "water" },
  "captions": [
    { "at": 0, "text": "海辺の町で描いた。" },
    { "at": 6, "text": "朝の光が水面で割れるとき、青が緑に変わる。" }
  ]
}
```

`captions` は `voice.mp3` の秒数に合わせて手で調整できる。自動生成は `note` を文で区切って等間隔に置く。

## 追加の手順

```bash
mkdir works/<id>
# painting.jpg, work.json, voice.mp3 を置く
npm run generate -- <id>
npm run dev -- --host     # https://<PCのIP>:5173/?w=<id> で確認
```
