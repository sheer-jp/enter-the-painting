// Claude API の SSE を読み、ブラウザに渡す出来事に直す（純関数と非同期イテレータ。Pages Functions のグローバルに触れない）

/**
 * SSE の行を区切る小さなパーサ。push に受け取った文字列を渡すと、完結した data: の JSON を返す
 */
export function createSseParser() {
  let buf = '';
  return {
    /** @param {string} chunk @returns {any[]} */
    push(chunk) {
      buf += chunk.replace(/\r\n/g, '\n');
      const out = [];
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        try { out.push(JSON.parse(data)); } catch { /* 壊れた行は捨てる */ }
      }
      return out;
    },
  };
}

/**
 * 上流の出来事 1 つを、ブラウザに渡す形に直す
 * { text } 文の断片、{ refusal: true } 拒否、{ done: true } 終わり、{ error: true } 上流の失敗。関係ないものは null
 * 状態を持たない。ツール呼び出し（{ recommend }）は createEventMapper が扱う
 * @param {any} ev
 * @returns {{ text: string } | { refusal: true } | { done: true } | { error: true } | null}
 */
export function mapEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') return ev.delta.text ? { text: ev.delta.text } : null;
  if (ev.type === 'message_delta' && ev.delta?.stop_reason === 'refusal') return { refusal: true };
  if (ev.type === 'message_stop') return { done: true };
  if (ev.type === 'error') return { error: true };
  return null;
}

// matched_moods の上限（ツールのスキーマの maxItems と同じ）
const MAX_MATCHED = 3;

/**
 * @typedef {{ recommend: string, alt: string | null, reason?: { ja: string, en: string }, matched_moods: string[] }} Recommend
 */

/**
 * ツールの入力を確かめる。形が合えば { recommend, alt, reason?, matched_moods }、合わなければ null
 * matched_moods は文字列だけを残し、最大 3 つ。無ければ []
 * @param {any} o
 * @returns {Recommend | null}
 */
export function normalizeRecommend(o) {
  if (!o || typeof o !== 'object' || typeof o.recommend !== 'string' || !o.recommend) return null;
  // キーの順は SSE の形（recommend、alt、reason、matched_moods）に揃える
  const reason = o.reason && typeof o.reason.ja === 'string' && typeof o.reason.en === 'string' ? { ja: o.reason.ja, en: o.reason.en } : null;
  const matched = Array.isArray(o.matched_moods) ? o.matched_moods.filter((/** @type {any} */ m) => typeof m === 'string' && m).slice(0, MAX_MATCHED) : [];
  return {
    recommend: o.recommend,
    alt: typeof o.alt === 'string' && o.alt ? o.alt : null,
    ...(reason ? { reason } : {}),
    matched_moods: matched,
  };
}

/**
 * 状態を持つ変換。mapEvent に加えて、ツール recommend_work の呼び出しを集める
 * content_block_start（tool_use）→ input_json_delta を index ごとに集め、content_block_stop で JSON.parse して { recommend } を 1 回返す
 * 壊れた JSON や形の合わない入力は捨てる（ブラウザは文の中の JSON を拾う経路に落ちる）
 * @param {string} [toolName]
 */
export function createEventMapper(toolName = 'recommend_work') {
  /** @type {Map<number, string>} */
  const tools = new Map();
  /** @param {any} ev */
  return (ev) => {
    if (!ev || typeof ev !== 'object') return null;
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      if (ev.content_block.name === toolName) tools.set(ev.index, '');
      return null;
    }
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
      if (tools.has(ev.index) && typeof ev.delta.partial_json === 'string') tools.set(ev.index, tools.get(ev.index) + ev.delta.partial_json);
      return null;
    }
    if (ev.type === 'content_block_stop' && tools.has(ev.index)) {
      const raw = /** @type {string} */ (tools.get(ev.index));
      tools.delete(ev.index);
      try {
        const rec = normalizeRecommend(JSON.parse(raw));
        return rec ? { recommend: rec } : null;
      } catch { return null; }
    }
    return mapEvent(ev);
  };
}

/**
 * 上流の本文（ReadableStream<Uint8Array>）を読み、createEventMapper の結果を順に返す
 * @param {ReadableStream<Uint8Array>} body
 */
export async function* relayEvents(body, { lang = 'ja' } = {}) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const parser = createSseParser();
  const map = createEventMapper();
  let finished = false;
  let sawText = false;   // 文を 1 つでも流したか。文なしでツールだけ来たら、reason を文として先に流す（11-07 CONV-1：12 会話中 1 回残った）
  try {
    for (;;) {
      const { value, done } = await reader.read();
      finished = done;
      const chunk = done ? dec.decode() + '\n\n' : dec.decode(value, { stream: true });
      for (const ev of parser.push(chunk)) {
        const m = map(ev);
        if (!m) continue;
        if (typeof m.text === 'string' && m.text.trim()) sawText = true;
        if (m.recommend && !sawText) {
          const r = m.recommend.reason;
          const fallback = r && (lang === 'ja' ? r.ja || r.en : r.en || r.ja);
          if (fallback) { yield { text: fallback }; sawText = true; }
        }
        yield m;
      }
      if (done) return;
    }
  } finally {
    // 途中でやめたときは上流を切る
    if (!finished) await reader.cancel().catch(() => {});
    else reader.releaseLock();
  }
}

/** ブラウザへの 1 行（SSE） @param {object} obj */
export const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
