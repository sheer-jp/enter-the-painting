# 気分から絵をすすめる：Claude API の中継（Cloudflare Worker）

ギャラリーの入口「どんな気分のときに、絵を見たいですか」の会話を、Claude API にストリーミングで中継する小さな Worker。設計と契約は `docs/RECOMMEND.md` の 8.4〜8.5、技術選定は `docs/ARCHITECTURE.md` の 12 節。

- 実行時に外部 API を呼ぶのは、サイト全体でこの Worker だけ（例外）
- API キーは Worker の Secret。ブラウザには出ない
- 会話はどこにも保存しない。ログにも残さない（状態コードだけ）
- 依存は `wrangler` だけ。サイトのバンドルには入らない
- API が無い・届かない・拒否されたときは、ブラウザ側がルールだけの版に落ちる

## ファイル

| ファイル | 役割 |
| --- | --- |
| `src/index.js` | 入口。`POST /api/recommend` と CORS の `OPTIONS`、本文の確かめ、IP ごとのレート制限、カタログの取得（10 分キャッシュ）、Claude API への中継 |
| `src/prompt.js` | system と Messages API の本文を組み立てる純関数（`buildSystem`、`buildBody`、`validateRequest`）。`tests/recommend-worker.test.ts` でテスト |
| `src/relay.js` | Claude API の SSE を読み、`data: {"text":"…"}` / `data: {"done":true}` に直す |
| `wrangler.toml` | ルート、変数 |

## API

```jsonc
// POST /api/recommend
{ "lang": "ja", "messages": [{ "role": "user", "content": "朝、静かに始めたい" }] }
// 応答：text/event-stream。data: {"text":"…"} を細切れに、最後に data: {"done":true}
//       途中で拒否されたら data: {"error":"refusal"} のあと done
// 失敗：{ "error": "bad_request" | "rate_limited" | "refusal" | "upstream" }、状態 400 / 429 / 422 / 502（許されない origin は 403）
```

制限：messages は 10 件まで、各 600 文字まで、最初と最後は user、user の件数は `turns[1] + 1` まで。IP ごと 1 分 10 回。

## 公開の手順（作家か Fable が行う。1 回だけ）

```bash
cd worker
npm i
npx wrangler login                          # Cloudflare のアカウント（sheerarts.com のあるもの）
npx wrangler secret put ANTHROPIC_API_KEY   # キーを貼る。リポジトリには書かない
npx wrangler deploy
```

変数は `wrangler.toml` の `[vars]` で直す：

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `SITE_ORIGIN` | `https://enter.sheerarts.com` | カタログ（`${SITE_ORIGIN}/catalog.json`）を読むサイト。CORS でも自動で許す |
| `ALLOWED_ORIGINS` | 本番、GitHub Pages、`http(s)://localhost:5173` | CORS で許す origin（カンマ区切り） |
| `CLAUDE_MODEL` | `claude-opus-5-5` | 応答が遅ければ `claude-sonnet-5-5` |
| `API_PATH` | `/api/recommend` | 受け付けるパス |

ルートは `enter.sheerarts.com/api/*`（`wrangler.toml` の `routes`）。`enter.sheerarts.com` のサイト本体（静的ホスティング）は今のまま。サイトが別の origin（GitHub Pages など）にあるときは、生成時に `RECOMMEND_API=https://enter.sheerarts.com/api/recommend npm run generate` とすると、ページの `<meta name="recommend-api">` にその URL が入る。

## 手元で動かす

```bash
cd worker
npm i
cat > .dev.vars <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...
SITE_ORIGIN=https://enter.sheerarts.com
EOF
npx wrangler dev                            # http://localhost:8787/api/recommend
```

`.dev.vars` はコミットしない（`.gitignore` 済み）。`SITE_ORIGIN` は公開済みのサイトでよい（カタログを読むだけ）。手元のカタログを使うときは、`npm run build` のあと `dist/` を `http://localhost:8000` などで配信して、そこを指す（自己署名の https は Worker から読めない）。

別の端末でサイトを動かす：

```bash
RECOMMEND_API=http://localhost:8787/api/recommend npm run generate
npm run dev
```

確かめ方（ストリームが流れれば OK）：

```bash
curl -N http://localhost:8787/api/recommend \
  -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' \
  -d '{"lang":"ja","messages":[{"role":"user","content":"朝、静かに始めたい"}]}'
```

## 補足

- Claude API は `fetch` で直接呼ぶ（SDK を入れない）。`stream: true`、`max_tokens: 600`、考える量は `effort: low`
- 安全分類で拒否されたときは、対応するモデルならサーバー側で推奨のモデルに引き継ぐ（`fallbacks: "default"`、ヘッダ `anthropic-beta: server-side-fallback-2026-07-01`）。それでも拒否されたら、文が出る前なら 422、途中なら `{"error":"refusal"}`
- system のカタログのブロックに `cache_control: {type: "ephemeral"}`。言語と往復数はその後ろのブロックに置くので、キャッシュは言語をまたいで効く（作品が少ないうちはキャッシュの最小長に届かず、効かないこともある）
- レート制限は isolate の中の Map なので厳密ではない
