# 部屋のイメージ（全作品で共用）

作品ページの「部屋で見る」と、体験の終わり（絵が部屋に掛かる場面）に使う。**部屋は AI 生成、絵は実物の写真を寸法の目安で合成**（絵の画像は生成モデルに入れない）。
プロンプトは `rooms/PROMPTS.md`。

| name | 場面 | 向いている作品（長辺 cm） | 生成ツール | 商用利用 |
| --- | --- | --- | --- | --- |
| entrance-house | 一軒家の玄関 | 20〜70 | ChatGPT（GPT の画像生成） | 可（作家確認済み） |
| living-apartment | マンションのリビング | 30〜120 | 同上 | 可 |
| living-window | 窓辺のリビング | 30〜120 | 同上 | 可 |
| living-chair | 椅子のあるリビング | 30〜120 | 同上 | 可 |
| living-sofa | ソファのあるリビング | 30〜120 | 同上 | 可 |
| studio-desk | 一人暮らしの机の上 | 15〜45 | ChatGPT | 可 
| studio-bedside | ベッド脇の夜 | 15〜45 | ChatGPT | 可（**使わない**。`disabled`。暗い部屋は不可、11-07 作家） 
| studio-shelf | 低い棚の上 | 15〜45 | ChatGPT | 可 
| studio-kitchen | キッチンカウンター | 15〜45 | ChatGPT | 可 
| studio-entrance | 小さな玄関 | 15〜45 | ChatGPT | 可 

`rooms/<name>.json`：`references`（壁と同じ平面にある基準物を `rooms/REFERENCES.json` の名前で指し、画像上の px を書く。`primary: true` が縮尺の主。例 `{ "ref": "door_interior.height", "px": 725, "primary": true }`。計算式と各部屋の計測は `docs/SCALE.md`）、`hang`（絵の中心 x、床の y、掛ける高さ。立って見る壁は 150cm、机やベッド脇は 125〜135cm）、`wall.corners_px`（正面の壁の範囲）、`suits_cm`（向いている作品の長辺の範囲）、`disabled`（文字列。入っていれば使わない。暗い部屋など）。px/cm・信頼度・比較の一文は `generate` が計算する。
縮尺の確認は `rooms/check/<name>_<作品id>.jpg`（生成時に出る。基準線と計算値入り）で行う。
作品側で `work.json` の `rooms` に名前を並べると、その順で使う（最初の部屋が体験の終わりに出る）。指定が無ければ `suits_cm` に合う部屋が全部使われる。
