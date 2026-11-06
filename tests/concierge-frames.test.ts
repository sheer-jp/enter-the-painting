// 受付のキャラクターのコマ列（A-1）と、受付の文節の改行（P-14）
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { parseFrameDef, phraseRuns, settledLength, fillPhrases, FRAME_MS } from '../src/concierge/index';

describe('parseFrameDef（frames.json の 1 項目）', () => {
  it('従来の形（配列）は 1 コマ 120ms', () => {
    expect(parseFrameDef(['listening', 'blink', 'listening'])).toEqual({ seq: ['listening', 'blink', 'listening'], ms: [120, 120, 120] });
  });
  it('{ seq, ms } の形：ms が数ならすべてのコマ、配列ならコマごと（足りない分は既定）', () => {
    expect(parseFrameDef({ seq: ['a', 'b'], ms: 160 })).toEqual({ seq: ['a', 'b'], ms: [160, 160] });
    expect(parseFrameDef({ seq: ['a', 'b', 'c'], ms: [120, 160] })).toEqual({ seq: ['a', 'b', 'c'], ms: [120, 160, FRAME_MS] });
  });
  it('壊れたものは null（コマは使わない）', () => {
    expect(parseFrameDef([])).toBeNull();
    expect(parseFrameDef(['../x'])).toBeNull();
    expect(parseFrameDef({ seq: 'a' })).toBeNull();
    expect(parseFrameDef(null)).toBeNull();
    expect(parseFrameDef({ seq: ['a'], ms: -5 })).toEqual({ seq: ['a'], ms: [FRAME_MS] });
  });
});

describe('public/concierge/artist/frames.json', () => {
  const dir = new URL('../public/concierge/artist/', import.meta.url);
  const defs = JSON.parse(readFileSync(new URL('frames.json', dir), 'utf8')) as Record<string, unknown>;
  it('11-07 のコマ列がそろっている（nod / tilt / tilt2 / think / happy と従来の blink / wave / smileDeep）', () => {
    for (const k of ['blink', 'wave', 'smileDeep', 'nod', 'tilt', 'tilt2', 'think', 'happy']) expect(parseFrameDef(defs[k]), k).not.toBeNull();
    // A-2 から、手を合わせたコマ（nod / tilt / happy）は smile 用
    expect(parseFrameDef(defs.nod)!.seq).toEqual(['smile', 'nod-1', 'nod-2', 'nod-1', 'smile']);
    expect(parseFrameDef(defs.happy)!.seq).toEqual(['smile', 'happy-1', 'happy-2', 'happy-1', 'smile']);
    expect(parseFrameDef(defs.think)!.seq[0]).toBe('think-1');
  });
  it('A-2：手の位置を合わせた列（listening 用の nod-down / tilt-down / tilt-down2、present 用の happy-up）', () => {
    expect(parseFrameDef(defs['nod-down'])!.seq).toEqual(['listening', 'nod-down-1', 'nod-down-2', 'nod-down-1', 'listening']);
    expect(parseFrameDef(defs['tilt-down'])!.seq).toEqual(['listening', 'tilt-down-1', 'listening']);
    expect(parseFrameDef(defs['tilt-down2'])!.seq).toEqual(['listening', 'tilt-down-2', 'listening']);
    expect(parseFrameDef(defs['happy-up'])!.seq).toEqual(['present', 'happy-up-1', 'happy-up-2', 'happy-up-1', 'present']);
  });
  it('WebP の合計は 3.0MB 以内', () => {
    const names = [...new Set(['listening', 'smile', 'present', ...Object.values(defs).flatMap((d) => parseFrameDef(d)!.seq)])];
    let total = 0;
    for (const n of names) for (const v of ['bust', 'full']) for (const sfx of ['', '@2x']) total += statSync(new URL(`${n}-${v}${sfx}.webp`, dir)).size;
    expect(total).toBeLessThanOrEqual(3_000_000);
  });
  it('どのコマにも 1x / 2x・上半身 / 全身・PNG / WebP の 8 枚がある', () => {
    const names = new Set(Object.values(defs).flatMap((d) => parseFrameDef(d)!.seq));
    for (const n of names) for (const v of ['bust', 'full']) for (const s of ['', '@2x']) for (const ext of ['png', 'webp']) {
      expect(existsSync(new URL(`${n}-${v}${s}.${ext}`, dir)), `${n}-${v}${s}.${ext}`).toBe(true);
    }
  });
});

describe('受付の文節（phraseRuns / settledLength）', () => {
  it('日本語は文節に分け、改行はそれだけの要素', () => {
    expect(phraseRuns('新しいことに踏み出すとき、\nちょっと怖くて。', 'ja')).toEqual(['新しい', 'ことに', '踏み出すとき、', '\n', 'ちょっと', '怖くて。']);
  });
  it('「踏み出すと／き」で切れない（文節をつなぐと元の文）', () => {
    const s = '今日は少し静かな気持ちで、新しいことに踏み出すときの絵を探しているんですね。';
    const r = phraseRuns(s, 'ja');
    expect(r.join('')).toBe(s);
    expect(r.some((p) => p.endsWith('すと'))).toBe(false);
  });
  it('文節の端の空白は別の要素（span の外の文字にして、ラテン文字の語の間の空白を残す）', () => {
    expect(phraseRuns('New Chapter。新しい章、', 'ja')).toEqual(['New', ' ', 'Chapter。', '新しい', '章、']);
  });
  it('日本語以外はそのまま', () => {
    expect(phraseRuns('Something quiet for the morning.', 'en')).toEqual(['Something quiet for the morning.']);
  });
  it('ストリーミング：確定するのは、次の文節の頭が来ている最後の句読点、または改行まで（閉じ括弧が続く句読点・終わりの句読点では切らない）', () => {
    expect(settledLength('朝の光のような')).toBe(0);
    expect(settledLength('こんにちは。朝の光の')).toBe(6);
    expect(settledLength('こんにちは。')).toBe(0);
    expect(settledLength('「静か」、それとも「にぎやか」。」つづき')).toBe('「静か」、'.length);
    expect(settledLength('はい。」と')).toBe(0);
    expect(settledLength('一行目\n二行')).toBe(4);
  });
});

// fillPhrases を DOM の小さな偽物で試す（vitest は node 環境）
class FakeNode {
  parentNode: FakeEl | null = null;
  get isConnected() { return !!this.parentNode; }
}
class FakeText extends FakeNode { constructor(public data: string) { super(); } get textContent() { return this.data; } }
class FakeEl extends FakeNode {
  children: FakeNode[] = []; className = ''; created = 0;
  constructor(public tag = 'p') { super(); }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }
  get textContent(): string { return this.children.map((c) => (c as FakeText | FakeEl).textContent).join(''); }
  set textContent(v: string) { this.children.forEach((c) => { c.parentNode = null; }); this.children = v ? [this.adopt(new FakeText(v))] : []; }
  private adopt<T extends FakeNode>(n: T): T { n.parentNode = this; return n; }
  appendChild(n: FakeNode) { this.insertBefore(n, null); return n; }
  append(...xs: (FakeNode | string)[]) { for (const x of xs) this.appendChild(typeof x === 'string' ? new FakeText(x) : x); }
  insertBefore(n: FakeNode, ref: FakeNode | null) {
    const nodes = n instanceof FakeFrag ? n.children.splice(0) : [n];
    const i = ref ? this.children.indexOf(ref) : this.children.length;
    this.children.splice(i, 0, ...nodes.map((x) => this.adopt(x)));
    return n;
  }
}
class FakeFrag extends FakeEl {}
describe('fillPhrases（ストリーミングは足すだけ。REVIEW-2 P2）', () => {
  let spans = 0;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => { spans++; return new FakeEl(tag); },
    createTextNode: (s: string) => new FakeText(s),
    createDocumentFragment: () => new FakeFrag(),
  };
  it('3 文字ずつ流しても、span は最後の数しか作らない。確定していない終わりは 1 つの文字ノード', () => {
    const text = '今日は少し静かな気持ちで、新しいことに踏み出すときの絵を。\nGolden Path という作品があります。';
    const el = new FakeEl();
    spans = 0;
    for (let i = 3; i < text.length; i += 3) {
      fillPhrases(el as unknown as HTMLElement, text.slice(0, i), 'ja', false);
      expect(el.textContent).toBe(text.slice(0, i));
      const last = el.lastChild as FakeText;
      expect(last).toBeInstanceOf(FakeText);
      expect(last.data).toBe(text.slice(settledLength(text.slice(0, i)), i));
    }
    fillPhrases(el as unknown as HTMLElement, text, 'ja');
    expect(el.textContent).toBe(text);
    const finalSpans = el.children.filter((c) => c instanceof FakeEl).length;
    expect(spans).toBe(finalSpans);   // 作り直していない
    // 全文を一度に文節にしたときと同じ並び
    const once = new FakeEl();
    fillPhrases(once as unknown as HTMLElement, text, 'ja');
    expect(el.children.filter((c) => c instanceof FakeEl).map((c) => (c as FakeEl).textContent)).toEqual(once.children.filter((c) => c instanceof FakeEl).map((c) => (c as FakeEl).textContent));
  });
  it('句読点のあとに閉じ括弧が別の差分で来ても、全文を一度にしたときと同じ文節', () => {
    const el = new FakeEl();
    for (const part of ['「はい。', '「はい。」と', '「はい。」と言った。']) fillPhrases(el as unknown as HTMLElement, part, 'ja', false);
    fillPhrases(el as unknown as HTMLElement, '「はい。」と言った。', 'ja');
    const once = new FakeEl();
    fillPhrases(once as unknown as HTMLElement, '「はい。」と言った。', 'ja');
    const ph = (e: FakeEl) => e.children.filter((c) => c instanceof FakeEl).map((c) => (c as FakeEl).textContent);
    expect(ph(el)).toEqual(ph(once));
  });
  it('前回の続きでない文（言語の切り替えなど）は最初から', () => {
    const el = new FakeEl();
    fillPhrases(el as unknown as HTMLElement, 'こんにちは。', 'ja');
    fillPhrases(el as unknown as HTMLElement, 'Hello.', 'en');
    expect(el.textContent).toBe('Hello.');
    expect(el.children.some((c) => c instanceof FakeEl)).toBe(false);
  });
});
