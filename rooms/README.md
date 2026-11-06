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
| studio-desk | 一人暮らしの机の上 | 15〜45 | ChatGPT | 可（**使わない**。`disabled`。置く部屋に置き換え、11-07） 
| studio-bedside | ベッド脇の夜 | 15〜45 | ChatGPT | 可（**使わない**。`disabled`。暗い部屋は不可、11-07 作家） 
| studio-shelf | 低い棚の上 | 15〜45 | ChatGPT | 可（**使わない**。`disabled`。置く部屋に置き換え、11-07） 
| studio-kitchen | キッチンカウンター | 15〜45 | ChatGPT | 可（**使わない**。`disabled`。置く部屋に置き換え、11-07） 
| studio-entrance | 小さな玄関 | 15〜45 | ChatGPT | 可（**使わない**。`disabled`。置く部屋に置き換え、11-07） 
| desk-easel | 机の上の卓上イーゼル（置く。`easel`） | 15〜45 | Codex（image_gen） | 可（作家確認済みと同じ扱い） |
| shelf-lean | 低い本棚に立てかけ（置く。`lean`） | 15〜45 | Codex（image_gen） | 可（同上） |
| sideboard-easel | サイドボードの上の卓上イーゼル（置く。`easel`） | 15〜45 | Codex（image_gen） | 可（同上） |

`rooms/<name>.json`：`references`（壁と同じ平面にある基準物を `rooms/REFERENCES.json` の名前で指し、画像上の px を書く。`primary: true` が縮尺の主。例 `{ "ref": "door_interior.height", "px": 725, "primary": true }`。計算式と各部屋の計測は `docs/SCALE.md`）、`hang`（絵の中心 x、床の y、掛ける高さ。立って見る壁は 150cm、机やベッド脇は 125〜135cm。**置く場面**は `hang.place`（`easel` / `lean`）と `hang.ledge_y_px`。`docs/PLACEMENT.md` 6 節）、`wall.corners_px`（正面の壁の範囲）、`suits_cm`（向いている作品の長辺の範囲）、`disabled`（文字列。入っていれば使わない。暗い部屋など）。px/cm・信頼度・比較の一文は `generate` が計算する。
縮尺の確認は `rooms/check/<name>_<作品id>.jpg`（生成時に出る。基準線と計算値入り）で行う。
作品側で `work.json` の `rooms` に名前を並べると、その順で使う（最初の部屋が体験の終わりに出る）。指定が無ければ `suits_cm` に合う部屋が全部使われる。

置く部屋の計測（11-07。Codex の目安 `concept/rooms-placed/PROMPTS.md` を出発点に、2048px の原画の画素の列を走査して測り直した。JSON は 1600px に縮めた値 = ×0.78125）：

| name | 受け（絵の底） | 中心 x | 縮尺の主 | 副 | px/cm（1600px） | 信頼度 |
| --- | --- | --- | --- | --- | --- | --- |
| desk-easel | 受け桟の上端 y1044（→ 816）、桟 x1092〜1410 | 1251（→ 977） | イーゼル 頂点 y738〜脚の先 y1174 = 435px（→ 340）= 28 cm | マグ 132px（9 cm）、閉じた PC 440px（30 cm） | 12.14 | high（ずれ 5.8%） |
| shelf-lean | 天板の奥 y1092・手前 y1127。立てかけた底は y1100（→ 859） | 880（→ 688） | 本棚の幅 x239〜1822 = 1583px（→ 1237）= 110 cm | 本棚の高さ 797px（→ 623）= 85 cm | 11.24 | low（画像の棚は横長で、幅と高さが同時に合わない） |
| sideboard-easel | 受け桟の上端 y1059（→ 827）、桟 x867〜1184 | 1025（→ 801） | イーゼル 頂点 y808〜脚の先 y1180 = 372px（→ 291）= 28 cm | サイドボードの幅 x64〜1986 = 1922px（→ 1502）= 160 cm | 10.39 | mid（ずれ 9.6%） |
