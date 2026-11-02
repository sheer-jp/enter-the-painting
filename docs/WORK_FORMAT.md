# 作品定義ファイル（`works/<id>/work.json`）

作家が触るのはこのファイルと画像・音声だけ。他はすべて `npm run generate -- <id>` が作る。

## 置くもの

```
works/<id>/
├─ painting.jpg   必須。原画の撮影画像。長辺 2000px 程度、正対して撮る
├─ work.json      必須。下記
└─ voice.mp3      任意。作家のナレーション（1〜3 分、日本語）
```

`<id>` は URL と QR に使う。英小文字・数字・ハイフンのみ（例：`blue-tide-2025`）。

## work.json

```jsonc
{
  "id": "blue-tide-2025",
  "title": { "ja": "青い潮", "en": "Blue Tide" },   // en は任意。無ければ翻訳で補う
  "year": 2025,
  "size_cm": [18, 14],                    // 実物の寸法（幅, 高さ）。入口と壁の絵の大きさに使う
  "medium": { "ja": "キャンバスに油彩", "en": "Oil on canvas" },

  // 奥から浮いてくるメッセージ。日本語で 1 文ずつ。1 文 40 文字以内、3〜10 文
  // 声（voice.mp3）があるなら、声で語る文と同じにする
  "messages": [
    "海辺の町で描いた。",
    "朝の光が水面で割れるとき、青が緑に変わる一瞬があった。",
    "その一瞬を、手のひらに収まる大きさに閉じ込めたかった。"
  ],

  // 英語だけは作家が目を通す。書けば翻訳の代わりに使う。他の言語は自動
  "messages_en": [
    "I painted this in a town by the sea.",
    "When the morning light broke on the water, there was a moment the blue turned green.",
    "I wanted to keep that moment at a size that fits in the palm of a hand."
  ],

  // 音
  "audio": {
    "voice": "voice.mp3",                 // 無ければ文字のみ
    "voice_at": [0, 7.5, 16.0],           // 各文の開始秒。省略時は等間隔。あとで手で直す
    "ambient": "water"                    // calm | wind | water | drone | none。省略時は自動
  },

  // 自動生成の上書き。すべて任意。無ければ自動値
  "overrides": {
    "flow_strength": 0.6,                 // 0〜1。筆致に沿う初期の流れの強さ
    "vorticity": 0.5,                     // 0〜1。渦の強さ
    "speed": 0.4,                         // 0〜1。流体全体の速さ
    "radius_m": 2.5,                      // 包まれる球面の半径
    "melt_distance_m": 1.0,               // 溶け始める距離
    "text_color": "#e8f0ff",              // 文字色。省略時は主要色の最も明るい色
    "back_color": "#0b1a2a",              // 球面の裏側の基調色。省略時は面積最大の色
    "quality": "high"                     // high | medium | low。流体の解像度段階
  }
}
```

## 生成されるもの（`works/<id>/generated/`）

| ファイル | 内容 |
| --- | --- |
| `painting_2048.jpg` / `painting_1024.jpg` | 流体の色テクスチャ用と入口表示用 |
| `flow.png` | 筆致の流れ場（R=cos θ、G=sin θ、B=強さ） |
| `translations.json` | メッセージ・タイトルの 10 言語分（キャッシュ。手で直してよい） |
| `space.json` | 実行時に読む唯一の定義 |
| `qr.svg` / `qr.png` | `BASE_URL/w/<id>/` の QR |
| `card.svg` | 作品カード印刷用（タイトル、寸法、QR） |

ビルド時にはさらに `dist/w/<id>/index.html`（作品ページ、OGP 付き）が作られる。

### space.json（実行時が読む）

```jsonc
{
  "id": "blue-tide-2025",
  "title": { "ja": "青い潮", "en": "Blue Tide", "fr": "Marée bleue", "...": "..." },
  "size_cm": [18, 14],
  "painting": "painting_2048.jpg",
  "palette": ["#0b1a2a", "#1f5f7a", "#5fa8b8", "#e8f0ff", "#c9a86a", "#2f3d2a"],
  "text_color": "#e8f0ff",
  "back_color": "#0b1a2a",
  "flow": { "texture": "flow.png", "strength": 0.6 },
  "fluid": { "vorticity": 0.5, "speed": 0.4, "quality": "high" },
  "space": { "radius_m": 2.5, "melt_distance_m": 1.0 },
  "audio": { "voice": "voice.mp3", "ambient": "water" },
  "messages": [
    { "at": 0,    "ja": "海辺の町で描いた。", "en": "I painted this in a town by the sea.", "fr": "...", "...": "..." },
    { "at": 7.5,  "ja": "朝の光が水面で割れるとき、…", "en": "...", "...": "..." }
  ]
}
```

言語コードは `ja, en, zh-Hans, zh-Hant, ko, fr, de, es, it, pt` の 10 個。無い言語は `en` に落ちる。

## 追加の手順

```bash
mkdir works/<id>
# painting.jpg, work.json, voice.mp3 を置く
npm run generate -- <id>     # 流れ場・翻訳・QR を生成（翻訳には ANTHROPIC_API_KEY が要る。無ければ ja / en のみ）
npm run dev -- --host        # https://<PCのIP>:5173/w/<id>/ で確認
```

翻訳が気に入らなければ `generated/translations.json` を直接直す。再生成しても手で直した訳は上書きしない。
