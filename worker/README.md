# 気分から絵をすすめる：Claude API の中継（Pages Functions に移した）

**2026-11-06（E-3）に Cloudflare Worker から Cloudflare Pages Functions に移した。** このフォルダにはこの README だけが残る。コードはリポジトリ直下の `functions/` にある。

ギャラリーの入口「どんな気分のときに、絵を見たいですか」の会話を、Claude API にストリーミングで中継する。サイト本体（`dist/`）と同じ Cloudflare Pages プロジェクトに置くので、API はサイトと同じ origin の `/api/recommend`。設計は `docs/ENTRANCE.md` 5 節、契約は `docs/RECOMMEND.md` の 8.4〜8.5、技術選定は `docs/ARCHITECTURE.md` の 12 節。

- 実行時に外部 API を呼ぶのは、サイト全体でこの関数だけ（例外）
- API キーは Pages の Secret（`ANTHROPIC_API_KEY`）。ブラウザには出ない
- 会話はどこにも保存しない。ログにも残さない（状態コードだけ）
- 依存は増やさない（Claude API は `fetch` で直接。SDK を入れない）。`wrangler` は `npx` で使う
- API が無い・届かない・拒否されたときは、ブラウザ側がルールだけの版に落ちる

## ファイル

| ファイル | 役割 |
| --- | --- |
| `functions/api/recommend.js` | 入口。`onRequestPost`（`POST /api/recommend`）と `onRequestOptions`。origin の確かめ、本文の確かめ、IP ごとのレート制限、カタログの取得（同じ配信の `/catalog.json` を `env.ASSETS` から。isolate の中に 10 分）、Claude API への中継 |
| `functions/_lib/prompt.js` | system、ツール `recommend_work`、Messages API の本文を組み立てる純関数（`buildSystem`、`buildTool`、`buildBody`、`validateRequest`）。`tests/recommend-worker.test.ts` でテスト |
| `functions/_lib/relay.js` | Claude API の SSE を読み、`data: {"text":"…"}` / `data: {"recommend":{…}}` / `data: {"done":true}` に直す |
| `wrangler.toml`（リポジトリ直下） | Pages プロジェクトの設定（`pages_build_output_dir = "dist"`、`[vars]` の `CLAUDE_MODEL`） |

`functions/` の中で `_` から始まるフォルダ（`_lib/`）はルートにならない（配信されない）。

## API

```jsonc
// POST /api/recommend（同じ origin）
{ "lang": "ja", "messages": [{ "role": "user", "content": "朝、静かに始めたい" }] }
// 応答：text/event-stream
//   data: {"text":"…"}                     文の断片（細切れに何度も）
//   data: {"recommend":{"recommend":"<id>","alt":"<id>"|null,"reason":{"ja":"…","en":"…"}}}
//                                          おすすめ（ツール recommend_work の呼び出し。出すときだけ 1 回）
//   data: {"done":true}                    終わり
//   途中で拒否されたら data: {"error":"refusal"} のあと done
// 失敗：{ "error": "bad_request" | "rate_limited" | "refusal" | "upstream" }、状態 400 / 429 / 422 / 502（許されない origin は 403）
```

制限：messages は 10 件まで、各 600 文字まで、最初と最後は user、user の件数は `turns[1] + 1` まで。IP ごと 1 分 10 回。

許す origin：同じ origin、`http(s)://localhost:5173`（`npm run dev` から叩けるように。このときだけ CORS のヘッダを付ける）、任意で変数 `ALLOWED_ORIGINS`（カンマ区切り）。

## 公開の手順（作家か Fable が行う。1 回だけ）

`docs/ENTRANCE.md` 5.2 のとおり。Cloudflare のダッシュボードで Pages プロジェクト `enter-the-painting` を作って GitHub を繋ぐか、手元から：

```bash
npm run generate && npm run build
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name enter-the-painting   # キーを貼る。リポジトリには書かない
npx wrangler pages deploy                                                           # wrangler.toml の dist/ と functions/ を上げる
```

変数は `wrangler.toml` の `[vars]` で直す：

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | 開発中はリーズナブルに。接客の質を上げたければ `claude-opus-5-5`（約 2 倍） |
| `ALLOWED_ORIGINS` | （なし） | 同じ origin と localhost:5173 のほかに許す origin（カンマ区切り）。ふつうは要らない |

ページの `<meta name="recommend-api">` は既定で `/api/recommend`（同じ origin）なので、生成時に `RECOMMEND_API` を指定しなくてよい。

## 手元で動かす

```bash
cat > .dev.vars <<'EOF'          # リポジトリ直下。コミットしない（.gitignore 済み）
ANTHROPIC_API_KEY=sk-ant-...
EOF
npm run build && npx wrangler pages dev dist   # http://localhost:8788/（サイトと /api/recommend が同じ origin）
```

確かめ方（ストリームが流れれば OK。`Origin` を付けないと 403）：

```bash
curl -N http://localhost:8788/api/recommend \
  -H 'Origin: http://localhost:8788' -H 'Content-Type: application/json' \
  -d '{"lang":"ja","messages":[{"role":"user","content":"朝、静かに始めたい"}]}'
```

`npm run dev`（Vite、`https://localhost:5173`）から叩くときは、生成時に `RECOMMEND_API=http://localhost:8788/api/recommend npm run generate` とする（別の origin なので CORS のヘッダが付く）。

## 補足

- Claude API は `fetch` で直接呼ぶ（SDK を入れない）。`anthropic-version: 2023-06-01`、`stream: true`、`max_tokens: 1500`（思考が数えられる）、考える量は `output_config: { effort: "low" }`。思考は常時オンのモデルなので `thinking` は送らない
- おすすめはツール `recommend_work`（`strict: true`）で受け取る。`tool_choice` は `{type: "auto"}`（Sonnet 5.5 / Opus 5.5 は `any` / `tool` を受け付けない）。呼ばれなかったときのために、ブラウザは文の中の `{"recommend":…}` を拾う経路も残している
- 安全分類で拒否されたときは、対応するモデルならサーバー側で推奨のモデルに引き継ぐ（`fallbacks: "default"`、ヘッダ `anthropic-beta: server-side-fallback-2026-07-01`）。それでも拒否されたら、文が出る前なら 422、途中なら `{"error":"refusal"}`
- system のカタログのブロックに `cache_control: {type: "ephemeral"}`。言語と往復数はその後ろのブロックに置くので、言語が違う会話でもカタログ部分はキャッシュから読まれる（作品が少ないうちはキャッシュの最小長に届かず、キャッシュされないこともある）
- レート制限は isolate の中の Map なので厳密ではない
