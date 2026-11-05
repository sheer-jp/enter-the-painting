# 設計書：気分から絵をすすめる（AI ヒアリング）V0

作家の構想：最初に「どういう気分のときに飾りたい絵か」を AI が聞いてくれて、チャットに書いていくと「今のあなたへのおすすめはこれ」と絵が出てきて、そこから絵の中に入る、またはギャラリー一覧を見る。Claude API を使う。
今の作業（流体・ページ）が終わったあとに作る。これは設計だけ。

## 1. 誰のどの悩みに効くか（`docs/USERS.md`）

- **E オンラインで絵を見る人**：5 作品が並んでいても、どれが「自分の」絵かわからない。買う気持ちは「この絵は自分のためにある」と思えたときに動く（P2）
- **B 来場者**：会場では作家が「どんな絵をお探しですか」と聞ける。オンラインにはその会話が無い
- 効かせ方：絵の説明をさせるのではなく、**その人の気分や暮らしを聞いて、作家の代わりに 1 点を差し出す**。作家が在廊しているときの接客をオンラインに置く

仮説 10：気分を聞かれてから出てきた 1 点は、一覧から選んだ 1 点より「自分の絵」と感じやすい。検証：すすめられた絵に入った人と一覧から入った人で、体験後の「買いたい」1〜5 を比べる。

## 2. 体験

ギャラリー `/` の宣言文の下に、静かな入口を 1 つ置く：「どんな気分のときに、絵を見たいですか」。

1. **ヒアリング（2〜4 往復）**：AI が短く聞く。例「最近、部屋で一番長く過ごす時間はいつですか」「その時間に、どんな色があると落ち着きますか」。質問は 1 回に 1 つ。答えは自由文でも、用意した 3〜4 個の選択肢（タップ）でもよい。選択肢があるとスマホで楽
2. **おすすめ（1 点 + 添え書き）**：「今のあなたには、この絵を。」と絵が 1 点、作家の言葉のトーンで 2〜3 文の理由。下に「この絵の中に入る」「他の作品も見る」。もう 1 点だけ「あるいは」として小さく
3. そこから作品ページ（`/w/<id>/?via=recommend`）へ。計測に入口を残す

言語は閲覧者の母語（既存の判定をそのまま）。声のトーンは作家の言葉（`messages`、`story`）に合わせる。説明や売り込みはしない。「販売中」かどうかは聞かれたら答える。

## 3. 仕組み

### 実行時に Claude API を呼ぶ（この機能だけの例外）

いまの規則は「実行時に外部 API を呼ばない」。この機能はチャットなので実行時に呼ぶ必要があり、**この機能だけの例外**として `CLAUDE.md` に書く。API キーはブラウザに置けないので、小さなサーバーを 1 つ置く。

- **Cloudflare Workers**（作家のドメインが Cloudflare にあるので同じ場所に）。`https://enter.sheerarts.com/api/recommend` にルーティング。キーは Worker の Secret
- Worker は Claude API の Messages をストリーミングで中継し、会話の履歴はブラウザ側が持つ（サーバーに保存しない）
- モデル：`claude-sonnet-5-5`（既定。11-05 作家の方針「開発中はリーズナブルなモデルから」。1 会話 4 往復で 3 円ほど）。接客の質を上げたければ `claude-opus-5-5`（約 2 倍）。`CLAUDE_MODEL` で切り替え
- 拒否（安全分類）や失敗時は、ルールだけのおすすめ（後述）に落ちる

### 作品カタログ（生成時に作る）

`npm run generate` で各作品に **気分のタグ**を付け、`public/catalog.json` にまとめる：

```jsonc
{ "id": "harmoney", "title": {...}, "size_cm": [53, 65.2], "availability": "available",
  "palette": ["#a47a62", ...], "warmth": 0.7, "brightness": 0.6, "energy": 0.8,   // 主要色から計算
  "moods": { "ja": ["朝の光", "ぶつかって、ほどける", "にぎやかな静けさ"], "en": [...] },   // Claude が messages と色から下書き、作家が直す
  "messages": [...], "story": {...} }
```

`moods` は作家が直せる（`works/<id>/work.json` の `moods` が正）。カタログ全体を system prompt に入れる（5〜20 作品なら数千トークン。プロンプトキャッシュで安くなる）。

### プロンプトの骨子（Worker 側）

- system：作家の紹介（1 段落）、話し方（短く、聞くのは 1 つずつ、売り込まない、説明より情景）、カタログ、出力の決まり
- 出力：会話中は普通の文。おすすめを出すときは、文のあとに JSON を 1 つ：`{"recommend":"<id>","alt":"<id>|null","reason":{"ja":"…","en":"…"}}`。ブラウザは JSON を見つけたら絵を出す（構造化出力 `output_config.format` が使えるなら、そちら）
- 2〜4 往復で必ずおすすめに至る。往復数は system で指示
- 会話の文は母語で。`reason` は母語と英語

### ルールだけのおすすめ（API が無いとき）

選択肢の答え（時間帯、色の好み、静か/にぎやか）を `warmth` `brightness` `energy` の 3 軸に写し、カタログで最も近い作品を出す。理由の文は作家が各作品に 1 行書いた `moods` から組む。API 無しでも成立するので、会場（電波が弱い）でも動く。

## 4. 画面

- ギャラリーの宣言文の下：「どんな気分のときに、絵を見たいですか」+ 入力欄 + 選択肢 3 つ（「朝、静かに」「夜、ひとりで」「人を迎える部屋に」など、作家が決める）
- 会話は吹き出しではなく、明朝の短い行が積み重なる形（`docs/DESIGN.md` のトーン）。AI の行は左、人の行は右寄せ、罫線なし
- おすすめは、絵が大きく出て、下に理由（明朝）、ボタン 2 つ
- スマホ優先。入力欄は画面下に固定

## 5. 計測・プライバシー

- 送るのは会話文だけ。名前・連絡先は聞かない（system で禁止）。会話は保存しない
- 計測：`recommend_start`、`recommend_done`、`enter_via_recommend`、`contact_via_recommend`（Cookie なし）
- 作品ページに「このおすすめは AI が作家の言葉をもとに選んだもの」と 1 行

## 6. 作業の見積もり

| 作業 | 時間 |
| --- | --- |
| generate：`warmth / brightness / energy` の計算、`moods` の下書き（Claude）、`catalog.json` | 2h |
| Worker：中継、ストリーミング、レート制限（IP ごと 1 分 10 回）、キーの Secret | 2h |
| 画面：入口、会話、おすすめ、作品ページへの導線、母語 | 4h |
| ルールだけのおすすめ（フォールバック） | 1h |
| プロンプトの調整（作家と 3 作品で試す） | 2h |

## 7. 決めてほしいこと

- 最初の 3 つの選択肢の言葉（作家の言葉で）
- おすすめは 1 点だけか、「あるいは」の 2 点目を出すか
- 会場でも使うか（使うならルールだけの版を先に）

## 8. V1：決定と実装の契約（11-04、Fable 設計 → Opus 実装）

作家「作品ページに行く手前の部分、そろそろ実装したい」。7 の「決めてほしいこと」は作家が外出中なので Fable が仮に決め、作家が直せる形にする。

### 8.1 仮の決定（作家が `recommend/config.json` で直せる）

- 最初の 3 つの選択肢（仮、作家の言葉に直す）：「朝、静かに始めたい」「夜、ひとりで息をつきたい」「人を迎える部屋に彩りを」
- おすすめは **1 点 + 「あるいは」もう 1 点を小さく**（作品が 2 点以上あるとき）。1 点しか無いときは正直に「いまはこの 1 点です」
- **会場でも使う**。API が無い・届かない・拒否されたときは、ルールだけの版に自動で落ちる（オフラインでも動く）
- 入口は**ギャラリー `/` の宣言文の下**。作品ページには置かない（作品ページは絵が主役）

### 8.2 ファイルと役割

```
recommend/config.json          作家が書く：作家の紹介（ja, en）、最初の選択肢 3 つ（ja, en）、往復数（2〜4）
recommend/translations.json    config の訳のキャッシュ（translate.js と同じ仕組み、ja のハッシュがキー）
scripts/generate/catalog.js    public/catalog.json を作る（作品の軸 warmth / brightness / energy、moods、文）
public/catalog.json            実行時に読む唯一のカタログ（ブラウザと Worker の両方が読む）
worker/                        Cloudflare Worker（wrangler.toml、src/index.js、src/prompt.js、README.md）。依存は wrangler だけ（サイトのバンドルには入らない）
src/recommend/                 画面（index.ts：入口・会話・おすすめ、rules.ts：ルールだけの版、parse.ts：出力の解釈）。「入口に触れた」ときに import() で読む
```

### 8.3 `public/catalog.json`

```jsonc
{
  "version": 1,
  "artist": { "intro": { "ja": "…", "en": "…" } },
  "openers": { "ja": ["朝、静かに始めたい", "…", "…"], "en": [...], "fr": [...] /* 10 言語。無い言語は en */ },
  "turns": [2, 4],                                  // 最短・最長の往復
  "works": [{
    "id": "harmoney", "title": { "ja": "…", "en": "…" }, "size_cm": [53, 65.2], "size_label": "F15", "year": 2025,
    "availability": "available",
    "palette": ["#a47a62", ...],
    "axes": { "warmth": 0.72, "brightness": 0.58, "energy": 0.81 },   // 0〜1
    "moods": { "ja": ["朝の光", "ぶつかって、ほどける", "にぎやかな静けさ"], "en": [...] },
    "messages": { "ja": ["…"], "en": ["…"] },
    "story": { "ja": "…", "en": "…" },
    "image": "works/harmoney/generated/painting_1024.jpg", "url": "w/harmoney/"
  }]
}
```

軸の計算（`scripts/generate/catalog.js`、主要色 `palette` とその重みから。重みが無ければ等分）：
- `warmth`：各色の色相 h（度）で `w = 0.5 + 0.5 × cos(h − 40°)`（橙 40° で 1、青 220° で 0）。彩度が低い色（HSL の S < 0.15）は 0.5 とする。重み付き平均
- `brightness`：各色の相対輝度（`luminance`）の重み付き平均を、`sqrt` で持ち上げる（暗い絵が 0 に張り付かないように）
- `energy`：`0.6 × 彩度の平均 + 0.4 × 色相の散らばり`。散らばりは色相の円周上の分散（1 − 平均ベクトルの長さ）。`space.json` の `motion.vorticity` があれば `0.5 × 上 + 0.5 × vorticity`
- `moods`：`work.json` の `moods.ja`（3〜5 語）が正。無ければ `ANTHROPIC_API_KEY` があるときだけ Claude が下書きし、`works/<id>/generated/moods.json` に書く（作家が `work.json` に移す）。無ければ空配列。訳は `translate.js` のキャッシュ（作品の `translations.json`）に乗せる

### 8.4 Worker の API

`POST {RECOMMEND_API}`（既定 `/api/recommend`。`npm run generate` が `<meta name="recommend-api">` に埋める。環境変数 `RECOMMEND_API` で変更。空文字ならルールだけの版）

```jsonc
// 要求
{ "lang": "ja", "messages": [{ "role": "user", "content": "朝、静かに始めたい" }, { "role": "assistant", "content": "…" }, ...] }
// 応答：text/event-stream。data: {"text":"…"} を細切れに、最後に data: {"done":true}
// 失敗：JSON { "error": "rate_limited" | "refusal" | "upstream" | "bad_request" }、状態 429 / 422 / 502 / 400
```

- 制限：messages は 10 件まで、各 600 文字まで、user の件数（往復）は `turns[1]` + 1 まで。超えたら 400
- レート制限：IP ごと 1 分 10 回（Worker の isolate 内の Map。厳密でなくてよい）
- CORS：`ALLOWED_ORIGINS`（カンマ区切り。`http://localhost:5173`, `https://localhost:5173` を含めてよい）
- カタログ：Worker が `${SITE_ORIGIN}/catalog.json` を取り、`caches.default` に 10 分
- Claude API：`fetch` で直接（SDK を入れない）。`POST https://api.anthropic.com/v1/messages`、`anthropic-version: 2023-06-01`、`stream: true`、モデルは `CLAUDE_MODEL`（既定 `claude-sonnet-5-5`）、`max_tokens: 1500`（思考が数えられる）。system は配列で、カタログのブロックに `cache_control: {type: "ephemeral"}`。`stop_reason` が `refusal` なら 422
- 秘密：`ANTHROPIC_API_KEY` は `wrangler secret put`。ログに会話を残さない

### 8.5 プロンプトの契約（`worker/src/prompt.js`、純関数でテストできるように）

system（日本語で書く。応答は `lang` の言語で）：
1. 作家の紹介（config の intro）
2. 話し方：短く（2〜3 文）、聞くのは 1 回に 1 つ、説明や売り込みはしない、情景で話す、名前・連絡先・年齢などの個人情報は聞かない・受け取っても使わない、絵の価格は答えない（「作家に聞けます」）
3. 進め方：往復 `turns[0]` 以上 `turns[1]` 以下で必ずおすすめに至る。いまが何往復目かは user の件数から数える（`turns[1]` 往復目には必ず出す）
4. カタログ（作品ごとに id、題名、寸法、販売、軸、moods、作家のメッセージ ja/en、物語 en）
5. 出力の決まり：**おすすめを出すときは、文のあとに改行して 1 行だけ** `{"recommend":"<id>","alt":"<id>"|null}`。文はその人への言葉で、理由をこめる（JSON に理由は入れない）。それ以外のときは文だけ。JSON の前後に \`\`\` を付けない

ブラウザ側（`src/recommend/parse.ts`）：ストリーム中は `{"recommend"` が現れた時点でそれ以降を表示しない。`done` で JSON を parse し、id がカタログに無ければ最初の作品にする。

### 8.6 ルールだけの版（`src/recommend/rules.ts`）

API が使えないとき（fetch 失敗、状態 4xx/5xx、最初の文字が 12 秒来ない、`navigator.onLine === false`）は、同じ会話の見た目で 3 問を選択肢だけで聞く：
1. 時間帯：朝 / 昼 / 夜 → brightness 0.8 / 0.6 / 0.3、夜は warmth +0.15
2. 色：あたたかい / 涼しい / 鮮やか / やわらか → warmth 0.85 / 0.2 / (energy 0.85, brightness 0.7) / (energy 0.25)
3. 静か / にぎやか → energy 0.25 / 0.8（2 で決めていれば平均）

3 軸のユークリッド距離が最小の作品をおすすめ、次点を「あるいは」。理由の文は `rec_reason` の型（「{title}。{mood1}、{mood2}。」。moods が無ければ title だけ）。文言は `src/i18n/ui.json` に 10 言語（`rec_` 接頭）。

### 8.7 画面（`src/recommend/index.ts`、`docs/DESIGN.md` のトーン）

- ギャラリーの宣言文の下に `<section class="recommend" id="recommend">`：見出し「どんな気分のときに、絵を見たいですか」、選択肢 3 つ（ボタン、明朝、罫線なし）、入力欄 + 送る。HTML は `pages.js` が出し、文言は `data-i18n`
- 会話：AI の行は左、人の行は右寄せ。吹き出しも罫線も無し。考え中は「…」が 1 行ゆっくり点滅
- おすすめ：絵（`painting_1024.jpg`）が幅いっぱいに出て、下に題名と寸法、AI の文（明朝）、ボタン「この絵の中に入る」（`w/<id>/?via=recommend`）と「他の作品も見る」（`.wall` へスクロール）。「あるいは」はその下に小さく（サムネイルと題名）。最後に 1 行「このおすすめは AI が作家の言葉をもとに選んだものです」
- おすすめが出たら入力欄は消え、「もう一度」で最初に戻る
- スマホ優先。入力欄は会話中だけ画面下に固定（`position: sticky; bottom: 0`）
- 読み込み：ページ用 JS（`page.ts`）には入口のハンドラだけ（選択肢かフォーカスで `import('./recommend/index.ts')`）。recommend のチャンクは gzip 12KB 以下
- 計測は入れない（U-8）。`?via=recommend` は残す

### 8.8 テスト

- `tests/catalog.test.ts`：軸の計算（赤橙の絵 → warmth 0.9 以上、青の絵 → 0.2 以下、灰色 → 0.5。暗い絵の brightness が 0 でない）
- `tests/recommend.test.ts`：`parse.ts`（ストリーム途中の切り詰め、JSON の取り出し、無い id の扱い）、`rules.ts`（3 問の答えから最も近い作品）、`worker/src/prompt.js`（system にカタログの id が全部入る、往復の上限の文が入る、`buildBody` が `stream: true` と `cache_control` を持つ）
- スモーク（`tests/smoke.mjs`）：ギャラリーで選択肢を押す → API が無いのでルールだけの版が出る → 3 問に答える → おすすめに作品の画像と「この絵の中に入る」が出る
