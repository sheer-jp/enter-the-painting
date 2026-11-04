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
| studio-desk | 一人暮らしの机の上 | 15〜45 | ChatGPT | 可 |（画像待ち）
| studio-bedside | ベッド脇の夜 | 15〜45 | ChatGPT | 可 |（画像待ち）
| studio-shelf | 低い棚の上 | 15〜45 | ChatGPT | 可 |（画像待ち）
| studio-kitchen | キッチンカウンター | 15〜45 | ChatGPT | 可 |（画像待ち）
| studio-entrance | 小さな玄関 | 15〜45 | ChatGPT | 可 |（画像待ち）

`rooms/<name>.json`：`image_width_px`、`wall.corners_px`（壁の 4 隅、左上から時計回り）、`wall.width_cm`（壁幅の目安。ドアの幅 80cm・高さ 200cm から逆算）、`wall.hang_center_ratio`（絵の中心を壁のどこに置くか。目の高さ 150cm）、`suits_cm`（向いている作品の長辺の範囲）。
作品側で `work.json` の `rooms` に名前を並べると、その順で使う（最初の部屋が体験の終わりに出る）。指定が無ければ `suits_cm` に合う部屋が全部使われる。
