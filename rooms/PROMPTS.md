# 部屋のイメージを画像生成 AI に頼むときのプロンプト（F15・縦位置の作品向け）

絵は合成するので、**壁は空けておく**ことが最重要。絵そのものは描かせない。
作品は F15（縦 65.2 × 横 53 cm）。この大きさが伝わるよう、人や家具（ソファ、椅子、ドア、本棚）を入れる。

## 共通の条件（すべてのプロンプトの末尾に付ける）

```
A blank, empty wall with clear space for one framed painting about 65 cm tall and 53 cm wide, hung at eye level (center about 145 cm from the floor). No artwork, no frames, no posters, no mirrors, no shelves on that wall. Even, diffuse, overcast daylight. No direct sunlight, no sunbeams, no light patches and no hard shadows on the wall; the wall is evenly lit. Photorealistic interior photograph, 35mm lens, eye-level camera, straight-on view of the wall (front-facing, minimal perspective distortion). Include a sofa, chair, door or person for scale. Muted, calm color palette. Aspect ratio 1:1 (square), high resolution.
```

絵を描かれてしまったら作り直す。壁は正面から（台形に歪まない）が合成しやすい。**壁に日差しの模様や影が落ちていると、重ねた絵だけ光が合わず浮く**ので、壁は均一な柔らかい光にする（11-04、作家の指摘）。

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

## 小さな作品向け（一人暮らしの部屋。F0〜F6、長辺 18〜41 cm）

小さな絵は広い壁だと消える。**壁に近いカメラ**で、机・棚・ベッド脇など、絵が自然に掛かる「小さな壁」を撮る。共通条件の絵の寸法を `about 30 cm tall and 24 cm wide` に、壁の幅は 1.5 m くらいに。

| # | name | プロンプト（英語） |
| --- | --- | --- |
| 11 | studio-desk | `A small one-room apartment in Tokyo. A compact wooden desk against a plain white wall, a laptop closed, a mug, a small lamp, a chair. Camera close to the wall (about 2 m), eye level, straight-on. Space on the wall above the desk for a small painting about 30 cm tall. Soft daylight from a window at the side.` + 共通（寸法を小さく） |
| 12 | studio-bedside | `A one-room apartment at night. A single bed with linen sheets seen from the side, a small bedside table with a warm lamp, a plain wall above the bedside table. Camera close, eye level. Space for a small painting about 30 cm tall.` + 共通 |
| 13 | studio-shelf | `A compact living space. A low wooden shelf with a few books and a plant, a plain wall above it, a floor cushion. Camera close to the wall, straight-on. Space for a small painting about 30 cm tall above the shelf.` + 共通 |
| 14 | studio-kitchen | `A small kitchen counter in a one-room apartment. A kettle, a cup, a plain tiled or plaster wall above the counter, morning light. Camera close, straight-on. Space for a small painting about 30 cm tall.` + 共通 |
| 15 | studio-entrance | `The tiny entrance of a one-room apartment. A pair of shoes, a plain wall beside the door, a small mirror-less wall, a hook with a bag. Camera close, straight-on. Space for a small painting about 30 cm tall.` + 共通 |

`rooms/<name>.json` の `suits_cm` を `[15, 45]` にしておくと、小さな作品のときだけ自動で使われる。

## 飾る場所の実例（日本の住宅で実際に絵が掛かる場所。`docs/PLACEMENT.md` 3 節）

これまでの画像は「空いた壁」。次は「絵が実際に掛かる場所」を撮る。家具が壁に接していて、その上に絵を置ける構図。カメラは正面、目の高さ。

| # | name | 場所 | 向く作品 | プロンプト（英語） |
| --- | --- | --- | --- | --- |
| 16 | entrance-shoe-cabinet | 玄関の靴箱の上 | F0〜F8 | `The entrance of a Japanese apartment. A low white shoe cabinet (about 90 cm tall) against a plain wall, a small plant and a tray of keys on top, tiled floor, the front door at the side. Camera straight-on, eye level. Empty wall above the cabinet for a small painting.` + 共通 |
| 17 | living-sofa-wall | ソファの上の壁 | F8〜F30 | `A living room with a grey three-seat sofa (about 180 cm wide) against a plain white wall, a floor lamp, a wooden coffee table. Camera straight-on from across the room, eye level. Empty wall above the sofa for a painting.` + 共通 |
| 18 | living-sideboard | サイドボードの上 | F3〜F10 | `A living room wall with a low wooden sideboard (about 80 cm tall, 160 cm wide), a vase and a few books on top, plain wall above. Camera straight-on, eye level. Empty wall above the sideboard for a painting.` + 共通 |
| 19 | hallway-end | 廊下の突き当たり | F0〜F6 | `A narrow hallway in a Japanese apartment, wooden floor, doors on the left, a plain wall at the end lit by a small ceiling light. Camera straight down the hallway, eye level. Empty wall at the end for a small painting.` + 共通 |
| 20 | bedroom-headboard | 寝室のヘッドボードの上 | F3〜F10 | `A bedroom with a double bed, a wooden headboard (about 90 cm tall) against a plain wall, linen sheets, two bedside lamps. Camera straight-on from the foot of the bed, eye level. Empty wall above the headboard for a painting.` + 共通 |
| 21 | dining-wall | ダイニングの壁 | F4〜F15 | `A dining area with a wooden table (72 cm tall) and four chairs against a plain wall, a pendant lamp, daylight from the side. Camera straight-on, eye level. Empty wall above the table for a painting.` + 共通 |
| 22 | tokonoma | 床の間 | F0〜F6 | `A Japanese tatami room with a tokonoma alcove, plain plaster wall inside the alcove, a small ikebana arrangement on the alcove floor, soft light from shoji screens. Camera straight-on, eye level. Empty alcove wall for a small painting.` + 共通 |

JSON には、家具の上端（`hang.furniture_top_y_px`）と家具の実寸（`references`）を書く。絵は家具の上端から 20 cm 空けて掛かる。

## ふつうのワンルーム（賃貸 6 畳。ゴージャスにしない。作家の指示 11-04）

これまでの画像は設計事務所の写真のように整いすぎている。多くの買い手の部屋は、賃貸のワンルーム（6 畳、天井 2.3 m、白いビニールクロス、ベージュのフローリング、アルミサッシ、シングルベッド、ローテーブル、カラーボックス）。生活感は少し、散らかりはなし。光は均一（直射日光なし）。

| # | name | 場所 | 向く作品 | プロンプト（英語） |
| --- | --- | --- | --- | --- |
| 23 | oneroom-bed-wall | ベッドの横の壁 | F0〜F8 | `A small, ordinary Japanese rental studio apartment (one-room, about 10 square meters). A single bed (100 cm wide) with a simple grey duvet against a plain white vinyl-wallpaper wall, beige laminate flooring, a low ceiling (about 230 cm), an aluminum-sash window with a plain beige curtain. Modest, lived-in, not styled, not luxurious. Camera straight-on at eye level. Empty wall above the bed for a small painting.` + 共通 |
| 24 | oneroom-lowtable | ローテーブルの向かいの壁 | F0〜F8 | `A small, ordinary Japanese rental studio apartment. A low wooden table (about 35 cm tall) on a beige rug, a floor cushion, a small TV on a low stand against a plain white wallpaper wall, beige laminate flooring, low ceiling (about 230 cm). Modest and plain, not styled. Camera straight-on at eye level. Empty wall above the TV stand for a small painting.` + 共通 |
| 25 | oneroom-colorbox | カラーボックスの上 | F0〜F6 | `A small, ordinary Japanese rental studio apartment. A three-tier white "color box" shelf (about 88 cm tall, 42 cm wide) against a plain white wallpaper wall, a few books and a mug on top, beige laminate flooring. Modest and plain. Camera close to the wall (about 2 m), straight-on at eye level. Empty wall above the shelf for a small painting.` + 共通（絵の寸法を 30 × 24 cm に） |
| 26 | oneroom-entrance | 賃貸の玄関 | F0〜F4 | `The tiny entrance of a Japanese rental studio apartment. A narrow space with a small white shoe cabinet (about 85 cm tall), a pair of sneakers on grey tiles, a plain white wallpaper wall, the unit bath door at the side. Modest and plain. Camera straight-on at eye level. Empty wall above the shoe cabinet for a small painting.` + 共通（絵の寸法を 30 × 24 cm に） |
| 27 | oneroom-desk-window | 窓際の小さな机 | F0〜F6 | `A small, ordinary Japanese rental studio apartment. A compact desk (about 100 cm wide, 72 cm tall) beside an aluminum-sash window with a plain curtain, a simple chair, a laptop closed, a plain white wallpaper wall above the desk, low ceiling. Modest and plain, not styled. Camera straight-on at eye level. Empty wall above the desk for a small painting.` + 共通（絵の寸法を 30 × 24 cm に） |
| 28 | onek-kitchen-wall | 1K のキッチン横の壁 | F0〜F6 | `A small Japanese 1K rental apartment. A compact single-burner kitchen counter (about 85 cm tall) with a stainless sink, a kettle and a mug, a plain white wallpaper wall beside it, a refrigerator, beige flooring. Modest and plain. Camera straight-on at eye level. Empty wall beside the kitchen for a small painting.` + 共通（絵の寸法を 30 × 24 cm に） |

`suits_cm` は `[15, 70]`（F15 も置いて「狭い部屋では大きく見える」を見せる）。基準物：シングルベッド幅 100 cm、カラーボックス高さ 88 cm、机 72 cm、天井 230 cm（`ceiling_old`）。

## 置く場面（小さな絵を卓上イーゼルに置く・棚に立てかける。11-07、`docs/PLACEMENT.md` 6 節）

作家「小さい絵が壁から浮いて見える。机やイーゼルに置く方がいい」を受けて、Codex（内蔵の image_gen）で 3 枚を生成（11-07）。商用利用は他の部屋と同じ扱い（作家確認済み）。生成記録の全文は `_meta/development/enter-the-painting/concept/rooms-placed/PROMPTS.md`（リポジトリの外）。返った画像は 1254px で、2048px に縦横同率で拡大したもの。ここでは幅 1600px に縮めて使う。

共通：写実の室内写真、正方形。絵・額・キャンバス・画板は入れない（空のイーゼル／棚の空き）。白い壁、明るい昼の拡散光、直射日光や光の模様なし。カメラは壁から 1.5〜2 m、正面、35mm 相当で縦の線を平行に。人・文字・ロゴなし。

| name | 場面 | プロンプトの要点（英語の要約） |
| --- | --- | --- |
| desk-easel | 机の上の卓上イーゼル | A bright modest Japanese studio apartment; oak desk (72 cm) against a plain white wall. On the desk: an EMPTY 28 cm tabletop A-frame easel slightly right of center (only legs, a slender mast and a horizontal receiving ledge; no canvas or board), a 9 cm mug and a closed 30 cm laptop on the left, a small potted plant on the right. Seated eye height, about 1.5 m from the wall. 追加調整：イーゼルだけを 15% 縮小（マグ・PC に対して大きすぎたため） |
| shelf-lean | 低い本棚に立てかける | A low oak bookshelf (85 cm tall, about 110 cm wide) against a plain white wall; a plant at the far left and plain books at the far right of the top; a clearly empty 40 cm area slightly left of center against the wall, for a painting to rest on the shelf and lean on the wall. Standing eye height, about 1.5 m from the wall |
| sideboard-easel | サイドボードの上の卓上イーゼル | A warm oak sideboard (80 cm tall, 160 cm wide) against a plain white wall in a living room; an EMPTY 28 cm tabletop easel exactly at the center, a small vase at the left end and a stack of plain books at the right end. Standing eye height, about 2 m from the wall. 追加調整：イーゼルだけを 22% 縮小 |

JSON は `hang.place`（`easel` / `lean`）、`hang.ledge_y_px`（絵の底が乗る y）、`hang.x_px`、イーゼルは `hang.ledge_x_px`（受けの左右の端。接地の影をこの中に）。縮尺の主はイーゼルの高さ 28 cm（`tabletop_easel.height`）、棚は本棚の幅。計測値は `rooms/README.md` の下の表。

## 受け取ったあとの手順

1. `rooms/<name>.jpg` として保存（横 1600px 以上）
2. `rooms/<name>.json` を作る（`rooms/living-apartment.json` を写す）。壁の 4 隅（左上から時計回り）と、壁幅の目安（例：ソファが 2 m なら壁は 3.5 m くらい）、`hang_center_ratio`（絵の中心を壁のどこに置くか）。4 隅は Claude に画像を渡せば下書きする
3. `rooms/README.md` の表に、使ったツールと商用利用の可否を書く
4. `npm run generate` で全作品に合成される。作品ページの「部屋で見る」と、体験の終わり（絵が部屋に掛かる場面）に使われる
