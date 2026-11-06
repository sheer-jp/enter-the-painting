// Claude API の SSE を読み、ブラウザに渡す出来事に直す（純関数と非同期イテレータ。Worker のグローバルに触れない）

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

/**
 * 上流の本文（ReadableStream<Uint8Array>）を読み、mapEvent の結果を順に返す
 * @param {ReadableStream<Uint8Array>} body
 */
export async function* relayEvents(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const parser = createSseParser();
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      finished = done;
      const chunk = done ? dec.decode() + '\n\n' : dec.decode(value, { stream: true });
      for (const ev of parser.push(chunk)) {
        const m = mapEvent(ev);
        if (m) yield m;
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
