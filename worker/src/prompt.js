// 気分から絵をすすめる：Claude API に渡す system と本文を組み立てる（docs/RECOMMEND.md 8.5）
// 純関数だけ。Worker のグローバルに触れない（vitest から import してテストする）

export const LANG_NAMES = {
  ja: '日本語', en: '英語（English）', 'zh-Hans': '簡体字中国語（简体中文）', 'zh-Hant': '繁体字中国語（繁體中文）', ko: '韓国語（한국어）',
  fr: 'フランス語（Français）', de: 'ドイツ語（Deutsch）', es: 'スペイン語（Español）', it: 'イタリア語（Italiano）', pt: 'ポルトガル語（Português）',
};

// 思考（effort low でも消せない）が max_tokens に数えられるので、文 2〜3 文 + JSON のために余裕を持たせる（レビューで 600 → 1500）
export const MAX_TOKENS = 1500;
// 安全分類で拒否されたとき、サーバー側で推奨のモデルに引き継ぐ（fallbacks: "default"）。対応するモデルだけに付ける
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'];
export const supportsFallbacks = (/** @type {string} */ model) => FALLBACK_MODELS.includes(model);

/** @param {any} obj @param {string} lang */
const pick = (obj, lang) => (obj && (obj[lang] || obj.en || obj.ja)) || '';
/** @param {any} catalog */
const turnsOf = (catalog) => (Array.isArray(catalog?.turns) && catalog.turns.length === 2 ? catalog.turns : [2, 4]);

/** @param {any} a @param {any} b */
const differs = (a, b) => !!a && JSON.stringify(a) !== JSON.stringify(b);

const AVAIL = { available: '販売中', sold: '売約済み', reserved: '商談中', not_for_sale: '非売品' };

// カタログを system 用の文にする（言語によらず同じ文。キャッシュが言語をまたいで効くように）
/** @param {any} catalog */
export function catalogText(catalog) {
  const works = catalog?.works || [];
  const lines = [`# 作品カタログ（${works.length} 点）`];
  for (const w of works) {
    const size = Array.isArray(w.size_cm) ? `${w.size_cm[0]} × ${w.size_cm[1]} cm` : '不明';
    const label = typeof w.size_label === 'string' ? w.size_label : w.size_label?.ja || '';
    const ax = w.axes || {};
    lines.push(
      '',
      `## id: ${w.id}`,
      `- 題名：${w.title?.ja || w.id}${differs(w.title?.en, w.title?.ja) ? ` / ${w.title.en}` : ''}`,
      `- 寸法：${size}${label ? `（${label}）` : ''}${w.year ? `、${w.year} 年` : ''}`,
      `- 販売：${(w.availability && AVAIL[w.availability]) || w.availability || '不明'}`,
      `- 軸（0〜1）：あたたかさ ${ax.warmth ?? '?'}、明るさ ${ax.brightness ?? '?'}、にぎやかさ ${ax.energy ?? '?'}`,
      `- 気分の言葉：${(w.moods?.ja || []).join('、') || '（なし）'}${differs(w.moods?.en, w.moods?.ja) ? ` / ${w.moods.en.join(', ')}` : ''}`,
      `- 作家のメッセージ（ja）：${(w.messages?.ja || []).join(' ')}`,
    );
    if (differs(w.messages?.en, w.messages?.ja)) lines.push(`- 作家のメッセージ（en）：${w.messages.en.join(' ')}`);
    if (w.story?.en) lines.push(`- 小さな物語（en、作家の下書き）：${w.story.en.replace(/\n+/g, ' ')}`);
  }
  return lines.join('\n');
}

/**
 * system の配列（docs/RECOMMEND.md 8.5 の 1〜5）。カタログのブロックに cache_control を付ける
 * 言語と往復数は変わるので、キャッシュの区切りより後ろのブロックに置く
 * @param {any} catalog
 * @param {string} lang
 * @param {number} [userTurns] いまの user の件数（buildBody が数える）
 * @returns {Array<{ type: 'text', text: string, cache_control?: { type: 'ephemeral' } }>}
 */
export function buildSystem(catalog, lang, userTurns) {
  const [minT, maxT] = turnsOf(catalog);
  const ids = (catalog?.works || []).map((/** @type {any} */ w) => w.id);
  const intro = catalog?.artist?.intro?.ja || '';
  const head = `あなたは、抽象画の作家のオンラインギャラリーの入口で、訪れた人の気分を聞き、作家の作品から 1 点をすすめる案内役です。

# 作家の紹介
${intro}

# 話し方
- 短く話す。1 回の応答は 2〜3 文まで。
- 聞くことは 1 回に 1 つだけ。
- 説明や売り込みはしない。絵の技法や価値を語らず、その人の暮らしの情景で話す（朝の光、帰り道、部屋の空気など）。
- 名前・連絡先・住所・年齢などの個人情報は聞かない。相手が書いても、覚えたり使ったりしない。
- 絵の価格は答えない。聞かれたら「価格は作家に聞けます」と伝える。
- カタログに無い作品や、作家について書かれていないことは作らない。

# 進め方
- 往復 ${minT} 回以上、${maxT} 回以下で、必ずおすすめに至る。
- いまが何往復目かは、user の発言の数で数える。${maxT} 往復目の応答では、必ずおすすめを出す。
- 最初は相手の気分や、絵を置きたい時間・場所を 1 つだけ聞く。`;

  const rules = `# 出力の決まり
- おすすめを出すときは、文のあとに改行して、次の形の JSON を 1 行だけ書く：
{"recommend":"<id>","alt":"<id>"|null}
- recommend と alt はカタログの id（${ids.join(', ') || 'なし'}）から選ぶ。作品が 2 点以上あるときは alt に 2 番目の候補、1 点だけのときは alt を null にして、文で正直に「いまはこの 1 点です」と伝える。
- 文はその人に向けた言葉で、なぜこの絵なのかを情景でこめる。JSON に理由は入れない。
- おすすめを出さないときは、文だけを書く（JSON を書かない）。
- JSON の前後に \`\`\` を付けない。JSON のあとには何も書かない。

# 応答の言語
- 応答の文は${LANG_NAMES[/** @type {keyof typeof LANG_NAMES} */ (lang)] || LANG_NAMES.en}で書く（カタログが日本語でも、訳して話す）。${
    typeof userTurns === 'number' ? `\n\n# いまの往復\n- いまは ${userTurns} 往復目（最大 ${maxT}）。${userTurns >= maxT ? 'この応答で必ずおすすめを出す。' : userTurns >= minT ? 'おすすめを出してよい。' : 'まだおすすめは出さず、1 つだけ聞く。'}` : ''
  }`;

  return [
    { type: 'text', text: head },
    { type: 'text', text: catalogText(catalog), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: rules },
  ];
}

/**
 * 会話を Messages API の形にそろえる（role と content だけ。content は文字列）
 * @param {any} messages
 * @returns {Array<{ role: 'user' | 'assistant', content: string }>}
 */
export function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content ?? '') }));
}

/**
 * Messages API の本文（stream: true）
 * @param {any} catalog
 * @param {string} lang
 * @param {any} messages
 * @param {string} model
 */
export function buildBody(catalog, lang, messages, model) {
  const msgs = sanitizeMessages(messages);
  const userTurns = msgs.filter((m) => m.role === 'user').length;
  /** @type {Record<string, any>} */
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    stream: true,
    // 短い接客の会話なので考える量は少なく（max_tokens を思考で使い切らないように）
    output_config: { effort: 'low' },
    system: buildSystem(catalog, lang, userTurns),
    messages: msgs,
  };
  if (supportsFallbacks(model)) body.fallbacks = 'default';
  return body;
}

// user は 600 文字まで。assistant はブラウザが AI の文をそのまま返すので、長めに（2000）
export const LIMITS = { messages: 10, chars: 600, assistantChars: 2000 };

/**
 * 要求の本文を確かめる（docs/RECOMMEND.md 8.4 の制限）。問題があれば理由の文字列、無ければ null
 * @param {any} body
 * @param {[number, number]} [turns]
 * @returns {string | null}
 */
export function validateRequest(body, turns = [2, 4]) {
  if (!body || typeof body !== 'object') return 'body';
  if (typeof body.lang !== 'string' || !(body.lang in LANG_NAMES)) return 'lang';
  const ms = body.messages;
  if (!Array.isArray(ms) || ms.length === 0 || ms.length > LIMITS.messages) return 'messages';
  for (const m of ms) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return 'role';
    if (typeof m.content !== 'string' || !m.content.trim() || m.content.length > (m.role === 'assistant' ? LIMITS.assistantChars : LIMITS.chars)) return 'content';
  }
  // 最初と最後は user（最後が assistant だと先読み扱いで API が 400 を返す）
  if (ms[0].role !== 'user' || ms[ms.length - 1].role !== 'user') return 'order';
  if (ms.filter((m) => m.role === 'user').length > turns[1] + 1) return 'turns';
  return null;
}
