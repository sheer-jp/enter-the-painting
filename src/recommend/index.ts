// 気分から絵をすすめる（docs/RECOMMEND.md 8.7）。ギャラリーの入口・会話・おすすめ。page.ts から import() で読む
// 会話はこのタブのメモリにだけ持ち、どこにも保存しない
import { t, pick, LANGS, type Lang } from '../i18n';
import { recommendByRules, pickMoods, buildReason, type Answers, type Catalog, type CatalogWork } from './rules';
import { splitRecommendation, resolveRecommendation, parseRecommendEvent, reasonText, type RecJson } from './parse';
import './recommend.css';

type Msg = { role: 'user' | 'assistant'; content: string };

const FIRST_BYTE_MS = 20000;   // 最初の文字がこれだけ来なければルールだけの版へ（モデルの思考で最初の文が遅れることがあるので 20 秒）

// ルールだけの版の 3 問
const QUESTIONS = [
  { key: 'time', q: 'rec_q_time', opts: ['morning', 'day', 'night'], label: 'rec_time_' },
  { key: 'color', q: 'rec_q_color', opts: ['warm', 'cool', 'vivid', 'soft'], label: 'rec_color_' },
  { key: 'mood', q: 'rec_q_mood', opts: ['quiet', 'lively'], label: 'rec_mood_' },
] as const;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

export function mountRecommend(section: HTMLElement, opts: { lang: Lang; api: string | null; catalogUrl: string }): void {
  if (section.dataset.mounted) return;
  section.dataset.mounted = '1';
  let lang = opts.lang;
  const catalogHref = new URL(opts.catalogUrl, location.href);
  const abs = (p: string) => new URL(p, catalogHref).href;

  const openers = section.querySelector<HTMLElement>('.rec-openers')!;
  const thread = section.querySelector<HTMLElement>('.rec-thread')!;
  const form = section.querySelector<HTMLFormElement>('.rec-form')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const send = form.querySelector<HTMLButtonElement>('button')!;

  // API が無い・オフラインなら最初からルールだけの版。一度落ちたらこのページではそのまま
  let rulesMode = !opts.api || navigator.onLine === false;
  let messages: Msg[] = [];
  let busy = false;
  let session = 0;   // 「もう一度」で古い応答を捨てるための番号

  let catalog: Catalog | null = null;
  const catalogReady = fetch(catalogHref)
    .then((r) => { if (!r.ok) throw new Error('catalog ' + r.status); return r.json() as Promise<Catalog>; })
    .then((c) => { catalog = c && Array.isArray(c.works) ? c : null; labelOpeners(); return catalog; })
    .catch((e) => { console.warn('カタログを読めない', e); return null; });

  // 文言（言語が変わったら差し替える）
  function labelUi() {
    input.placeholder = t('rec_placeholder', lang);
    input.setAttribute('aria-label', t('rec_placeholder', lang));
    send.textContent = t('rec_send', lang);
  }
  function labelOpeners() {
    const list = catalog?.openers?.[lang] || catalog?.openers?.en || catalog?.openers?.ja;
    if (!list) return;
    openers.querySelectorAll<HTMLButtonElement>('button[data-opener-index]').forEach((b) => {
      const s = list[+b.dataset.openerIndex!];
      if (s) b.textContent = s;
    });
  }
  labelUi(); labelOpeners();
  const langSelect = document.getElementById('lang') as HTMLSelectElement | null;
  langSelect?.addEventListener('change', () => {
    if ((LANGS as readonly string[]).includes(langSelect.value)) { lang = langSelect.value as Lang; labelUi(); labelOpeners(); }
  });

  // 会話の行（AI は左、人は右）
  function line(who: 'ai' | 'me', text: string): HTMLParagraphElement {
    const p = h('p', `rec-line rec-${who}`, text);
    thread.appendChild(p);
    return p;
  }
  function thinking(): HTMLParagraphElement {
    const p = h('p', 'rec-line rec-ai rec-thinking');
    p.append(h('span', '', '…'), h('span', 'rec-vh', t('rec_thinking', lang)));
    p.firstElementChild!.setAttribute('aria-hidden', 'true');
    thread.appendChild(p);
    return p;
  }

  function begin() {
    section.classList.add('is-active');
    openers.hidden = true;
    form.hidden = rulesMode;
  }

  function reset() {
    session++;
    messages = []; busy = false;
    thread.textContent = '';
    section.classList.remove('is-active', 'is-done');
    openers.hidden = false;
    form.hidden = false;
    input.disabled = send.disabled = false;
    input.value = '';
    openers.querySelector('button')?.focus();
  }

  // 人の言葉を受け取る（選択肢 or 入力欄）
  async function say(text: string) {
    text = text.trim().slice(0, 600);
    if (!text || busy) return;
    begin();
    line('me', text);
    if (rulesMode) { startRules(); return; }
    messages.push({ role: 'user', content: text });
    busy = true;
    input.disabled = send.disabled = true;
    const ok = await askAi(session);
    busy = false;
    if (!ok) return;
    input.disabled = send.disabled = false;
    if (!section.classList.contains('is-done')) input.focus({ preventScroll: true });
  }

  // AI に聞く。ストリームを受けて文を少しずつ出す。失敗したらルールだけの版へ落ちて false
  async function askAi(my: number): Promise<boolean> {
    const wait = thinking();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FIRST_BYTE_MS);
    let acc = '';
    let out: HTMLParagraphElement | null = null;
    let toolRec: RecJson | null = null;   // data: {"recommend": ...}（ツール呼び出し）で受けたおすすめ
    try {
      const res = await fetch(opts.api!, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lang, messages }), signal: ctrl.signal,
      });
      if (!res.ok || !res.body || !/event-stream/.test(res.headers.get('content-type') || '')) throw new Error('api ' + res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let done = false;
      while (!done) {
        const r = await reader.read();
        if (my !== session) { ctrl.abort(); return false; }
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        let k: number;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, k); buf = buf.slice(k + 2);
          for (const l of ev.split('\n')) {
            if (!l.startsWith('data:')) continue;
            let d: { text?: string; done?: boolean; error?: string; recommend?: unknown };
            try { d = JSON.parse(l.slice(5)); } catch { continue; }
            if (d.error) throw new Error(d.error);
            if (d.done) { done = true; break; }
            if (d.recommend !== undefined) {
              const rec = parseRecommendEvent(d.recommend);
              if (rec) { toolRec = rec; clearTimeout(timer); }
              continue;
            }
            if (typeof d.text === 'string') {
              if (!out) { clearTimeout(timer); out = h('p', 'rec-line rec-ai'); wait.replaceWith(out); }
              acc += d.text;
              out.textContent = splitRecommendation(acc).prose;
            }
          }
          if (done) break;
        }
      }
      if (!acc && !toolRec) throw new Error('empty');
    } catch (e) {
      clearTimeout(timer);
      if (my !== session) return false;
      console.warn('AI に届かない。ルールだけの版にする', e);
      wait.remove();
      if (out && !splitRecommendation(acc).prose) out.remove();
      rulesMode = true;
      form.hidden = true;
      startRules();
      return false;
    }
    clearTimeout(timer);
    const split = splitRecommendation(acc);
    // ツール呼び出しで受けたおすすめを優先し、無ければ文の中の JSON を拾う（保険）
    const json = toolRec || split.json;
    const prose = split.prose || (json ? reasonText(json, lang) : '');
    // 会話の履歴は文だけ（API は空の assistant を受け付けないので、文が空なら理由で埋める）
    messages.push({ role: 'assistant', content: acc || prose });
    if (json) {
      const c = await catalogReady;
      if (my !== session) return false;
      if (!c?.works.length) { offline(); return false; }
      if (!out) { out = h('p', 'rec-line rec-ai'); wait.replaceWith(out); }
      out.textContent = prose;
      showCard(c, resolveRecommendation(json, c), out);
      return true;
    }
    // 最大の往復まで来てもおすすめが出なかった（JSON が無い）：次の送信は Worker が 400 にするので、先にルールだけの版へ
    const maxTurns = (await catalogReady)?.turns?.[1] ?? 4;
    if (messages.filter((m) => m.role === 'user').length >= maxTurns) {
      if (my !== session) return false;
      rulesMode = true;
      form.hidden = true;
      startRules();
      return false;
    }
    return true;
  }

  // ルールだけの版：3 問を選択肢で聞く
  async function startRules() {
    const my = session;
    const c = await catalogReady;
    if (my !== session) return;
    if (!c?.works.length) { offline(); return; }
    const answers: Partial<Answers> = {};
    const ask = (i: number) => {
      if (my !== session) return;
      if (i >= QUESTIONS.length) { finishRules(c, answers as Answers); return; }
      const q = QUESTIONS[i];
      line('ai', t(q.q, lang));
      const box = h('div', 'rec-choices');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', t(q.q, lang));
      for (const v of q.opts) {
        const b = h('button', 'rec-opt', t(q.label + v, lang));
        b.type = 'button';
        b.addEventListener('click', () => {
          (answers as Record<string, string>)[q.key] = v;
          box.remove();
          line('me', b.textContent || v);
          ask(i + 1);
        });
        box.appendChild(b);
      }
      thread.appendChild(box);
      (box.firstElementChild as HTMLButtonElement).focus({ preventScroll: true });
    };
    ask(0);
  }

  function finishRules(c: Catalog, answers: Answers) {
    let pickd: { id: string; alt: string | null };
    if (c.works.length === 1) { line('ai', t('rec_only_one', lang)); pickd = { id: c.works[0].id, alt: null }; }
    else pickd = recommendByRules(c, answers);
    const w = c.works.find((x) => x.id === pickd.id)!;
    const prose = h('p', 'rec-line rec-ai', buildReason(t('rec_reason', lang), pick(w.title, lang), pickMoods(w, lang)));
    showCard(c, pickd, prose);
  }

  function offline() {
    form.hidden = true;
    line('ai', t('rec_offline', lang));
    finishButtons(h('div', 'rec-card'), false);
  }

  // おすすめ：絵、題名と寸法、文、ボタン 2 つ、「あるいは」、注記、「もう一度」
  function showCard(c: Catalog, r: { id: string; alt: string | null }, prose: HTMLElement) {
    const w = c.works.find((x) => x.id === r.id)!;
    section.classList.add('is-done');
    form.hidden = true;
    const card = h('div', 'rec-card');
    const fig = h('figure', 'rec-fig');
    const img = h('img');
    img.src = abs(w.image); img.alt = pick(w.title, lang);
    if (w.size_cm) img.style.aspectRatio = `${w.size_cm[0]} / ${w.size_cm[1]}`;
    const cap = h('figcaption', 'rec-cap');
    cap.append(h('b', '', pick(w.title, lang)), h('span', '', sizeText(w)));
    fig.append(img, cap);
    prose.classList.add('rec-prose');
    card.append(fig, prose);
    const acts = h('div', 'rec-actions');
    const enter = h('a', 'btn primary rec-enter', t('rec_enter', lang));
    enter.href = viaRecommend(w);
    const others = h('button', 'btn ghost rec-others', t('rec_others', lang));
    others.type = 'button';
    others.addEventListener('click', () => {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.querySelector('.wall')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
    acts.append(enter, others);
    card.appendChild(acts);
    const alt = r.alt ? c.works.find((x) => x.id === r.alt) : null;
    if (alt) {
      const a = h('a', 'rec-alt');
      a.href = viaRecommend(alt);
      const ti = h('img');
      ti.src = abs(alt.image); ti.alt = ''; ti.loading = 'lazy';
      const tx = h('span');
      tx.append(h('small', '', t('rec_or', lang)), h('b', '', pick(alt.title, lang)), h('span', '', sizeText(alt)));
      a.append(ti, tx);
      card.appendChild(a);
    }
    card.appendChild(h('p', 'rec-note', t('rec_note', lang)));
    finishButtons(card, true);
    enter.focus({ preventScroll: true });
  }

  function finishButtons(card: HTMLElement, done: boolean) {
    const again = h('button', 'rec-again', t('rec_again', lang));
    again.type = 'button';
    again.addEventListener('click', reset);
    card.appendChild(again);
    thread.appendChild(card);
    if (!done) again.focus({ preventScroll: true });
  }

  const sizeText = (w: CatalogWork) => (w.size_cm ? `${w.size_cm[0]} × ${w.size_cm[1]} cm` : '');
  const viaRecommend = (w: CatalogWork) => {
    const u = new URL(w.url, catalogHref);
    u.searchParams.set('via', 'recommend');
    return u.href;
  };

  // 入口：選択肢と入力欄
  openers.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-opener-index]');
    if (b) say(b.innerText || b.textContent || '');   // 隠れた訳（span[hidden]）は含めない
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    say(v);
  });
}
