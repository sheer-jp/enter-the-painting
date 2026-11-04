# 部屋のイメージを画像生成 AI に頼むときのプロンプト（F15・縦位置の作品向け）

絵は合成するので、**壁は空けておく**ことが最重要。絵そのものは描かせない。
作品は F15（縦 65.2 × 横 53 cm）。この大きさが伝わるよう、人や家具（ソファ、椅子、ドア、本棚）を入れる。

## 共通の条件（すべてのプロンプトの末尾に付ける）

```
A blank, empty wall with clear space for one framed painting about 65 cm tall and 53 cm wide, hung at eye level (center about 150 cm from the floor). No artwork, no frames, no posters, no mirrors, no shelves on that wall. Natural, soft light. Photorealistic interior photograph, 35mm lens, eye-level camera, straight-on view of the wall (front-facing, minimal perspective distortion). Include a sofa, chair, door or person for scale. Muted, calm color palette. Aspect ratio 16:10, high resolution.
```

絵を描かれてしまったら作り直す。壁は正面から（台形に歪まない）が合成しやすい。

## 場面ごと（MVP は 1〜3 の 3〜4 枚、余裕があれば 10 枚）

| # | name | プロンプト（英語） |
| --- | --- | --- |
| 1 | living-apartment | `A modern Tokyo apartment living room in the morning. A low grey fabric sofa facing a white plaster wall, a small wooden side table, a houseplant in the corner, pale wooden floor, soft morning light from a window at the left.` + 共通 |
| 2 | entrance-house | `The entrance hall of a quiet Japanese house. A wooden step where shoes are removed, a narrow white wall beside a wooden door, a small bench, warm afternoon light.` + 共通 |
| 3 | bedroom | `A calm bedroom at night. A bed with linen sheets seen from the side, a bedside lamp casting warm light, a plain wall above the bed.` + 共通（壁は「ベッドの横」と指定） |
| 4 | study | `A small study room. A wooden desk by a window, a chair, a bookshelf on the left, a plain wall above the desk, soft daylight.` + 共通 |
| 5 | hotel-lobby | `The lobby of a quiet design hotel. A leather sofa, a tall indoor plant, polished stone floor, high ceiling, a large plain concrete wall, warm diffuse light.` + 共通 |
| 6 | hotel-room | `A hotel guest room. A bed with white sheets, a wooden headboard, a plain wall above the headboard, a window with sheer curtains, evening light.` + 共通 |
| 7 | cafe | `A small quiet café. A wooden counter, two stools, one person reading, a plain plaster wall behind the counter, warm pendant lights.` + 共通 |
| 8 | office-reception | `A minimal office reception. A light wooden reception desk, a plain wall behind it, a single armchair, bright even daylight.` + 共通 |
| 9 | hallway | `A long quiet hallway in an apartment. A plain wall along the left, a wooden floor, a door at the end, soft light.` + 共通 |
| 10 | gallery | `A white-cube gallery. One empty white wall, concrete floor, a bench, even gallery lighting, nobody.` + 共通 |

## 受け取ったあとの手順

1. `rooms/<name>.jpg` として保存（横 1600px 以上）
2. `rooms/<name>.json` を作る（`rooms/living-apartment.json` を写す）。壁の 4 隅（左上から時計回り）と、壁幅の目安（例：ソファが 2 m なら壁は 3.5 m くらい）、`hang_center_ratio`（絵の中心を壁のどこに置くか）。4 隅は Claude に画像を渡せば下書きする
3. `rooms/README.md` の表に、使ったツールと商用利用の可否を書く
4. `npm run generate` で全作品に合成される。作品ページの「部屋で見る」と、体験の終わり（絵が部屋に掛かる場面）に使われる
