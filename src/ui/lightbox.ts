// 部屋で見る の拡大表示（ライトボックス）。寸法線（SVG を画像に重ねる）と詳しい文章。docs/SIZE_UX.md 4〜5 節
// 作品ページで帯の画像を初めてタップしたときに import() で読む（ページ用 JS を小さく保つ）
import { t, pick, type Lang } from '../i18n';
import type { Multi, Room } from '../experience/types';

export interface LightboxSpace { size_cm: [number, number]; size_label?: Multi | null; rooms: Room[] }
export interface LightboxOptions { space: LightboxSpace; srcs: string[]; index: number; lang: Lang; returnFocus?: HTMLElement | null }

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_ZOOM = 2;
const GAP = 12;         // 寸法線と絵の間（画面の px）
const TICK = 5;         // 目盛りの半分の長さ
const FONT = 12;        // ラベルの文字の大きさ
const SMALL = 60;       // 絵がこれより小さい（画面の px）ときはラベルを 1 行にまとめる

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag); e.className = cls; parent?.appendChild(e); return e;
};
const svgEl = (tag: string, attrs: Record<string, string | number>, parent: Element) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e); return e;
};

export function openLightbox(o: LightboxOptions): () => void {
  const { space, srcs, lang } = o;
  const rooms = space.rooms;
  let index = o.index;
  let showDims = true;
  let zoom = 1, tx = 0, ty = 0;
  let fit = { w: 0, h: 0, k: 1 };   // 画像を画面に収めた大きさと倍率（画面 px / 画像 px）
  let dimsTimer = 0;

  const root = el('div', 'lb');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  const media = el('div', 'lb-media', root);
  const frame = el('div', 'lb-frame', media);
  const img = el('img', 'lb-img', frame); img.alt = ''; img.draggable = false;
  const svg = document.createElementNS(SVG_NS, 'svg'); svg.setAttribute('class', 'lb-dims'); svg.setAttribute('aria-hidden', 'true');
  frame.appendChild(svg);
  const prev = el('button', 'lb-nav lb-prev', media); prev.type = 'button'; prev.textContent = '‹'; prev.setAttribute('aria-label', t('prev_room', lang));
  const next = el('button', 'lb-nav lb-next', media); next.type = 'button'; next.textContent = '›'; next.setAttribute('aria-label', t('next_room', lang));
  const text = el('div', 'lb-text', root);
  const head = el('p', 'lb-head', text);
  const body = el('div', 'lb-body', text);
  const tools = el('div', 'lb-tools', text);
  const toggle = el('button', 'lb-tool', tools); toggle.type = 'button';
  const zoomBtn = el('button', 'lb-tool', tools); zoomBtn.type = 'button'; zoomBtn.textContent = '2×'; zoomBtn.setAttribute('aria-label', t('zoom', lang));
  const close = el('button', 'lb-close', root); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', t('close', lang));
  if (rooms.length < 2) { prev.hidden = true; next.hidden = true; }

  // ---- 文章（比較 → 寸法 → 2 つ目の比較 → 部屋の説明 → 注記。信頼度 low は注記を先頭に） ----
  function renderText(room: Room) {
    const [w, h] = space.size_cm.map((v) => Math.round(v));
    const label = pick(space.size_label, lang);
    const size = label ? t('size_line_label', lang, { label, w, h }) : t('size_line', lang, { w, h });
    const parts: [string, string][] = [['lb-lead', pick(room.compare, lang)], ['lb-size', size], ['', pick(room.compare2, lang)], ['', pick(room.about, lang)]];
    const note: [string, string] = ['lb-note', pick(room.note, lang)];
    if (room.confidence === 'low') parts.unshift(note); else parts.push(note);
    body.replaceChildren(...parts.filter(([, s]) => s).map(([cls, s]) => { const p = document.createElement('p'); p.textContent = s; if (cls) p.className = cls; return p; }));
    const where = pick(room.label, lang);
    head.textContent = `${room.category ? `${t(`room_cat_${room.category}`, lang)} ─ ${where}` : where}${rooms.length > 1 ? `　${index + 1} / ${rooms.length}` : ''}`;
    root.setAttribute('aria-label', pick(room.label, lang));
    toggle.textContent = t(showDims ? 'dims_hide' : 'dims_show', lang);
    toggle.setAttribute('aria-pressed', String(showDims));
  }

  // ---- 寸法線（座標は画像の px。線の太さと文字は画面の px で一定にする） ----
  function drawDims(room: Room) {
    svg.replaceChildren();
    const [iw, ih] = room.image_px || [img.naturalWidth, img.naturalHeight];
    svg.setAttribute('viewBox', `0 0 ${iw} ${ih}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const q = room.quad_px; if (!q || !fit.k) return;
    const u = 1 / fit.k;   // 画面の 1px を画像の px に
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const [wcm, hcm] = space.size_cm.map((v) => Math.round(v));
    const g = svgEl('g', { stroke: 'currentColor', 'stroke-width': 1, fill: 'none' }, svg);
    const line = (ax: number, ay: number, bx: number, by: number) => svgEl('line', { x1: ax, y1: ay, x2: bx, y2: by, 'vector-effect': 'non-scaling-stroke' }, g);
    const font = FONT * u;
    const label = (s: string, x: number, y: number, anchor: 'start' | 'middle' | 'end', baseline = 'alphabetic') => {
      const e = svgEl('text', { x, y, 'text-anchor': anchor, 'dominant-baseline': baseline, 'font-size': font, fill: 'currentColor' }, svg);
      e.textContent = s; return e;
    };
    const textW = (s: string) => s.length * font * 0.58;
    // 幅：絵の下
    const wy = y1 + GAP * u;
    line(x0, wy, x1, wy); line(x0, wy - TICK * u, x0, wy + TICK * u); line(x1, wy - TICK * u, x1, wy + TICK * u);
    // 高さ：絵の右
    const hx = x1 + GAP * u;
    line(hx, y0, hx, y1); line(hx - TICK * u, y0, hx + TICK * u, y0); line(hx - TICK * u, y1, hx + TICK * u, y1);
    const sizeLabel = pick(space.size_label, lang);
    const small = (x1 - x0) * fit.k < SMALL || (y1 - y0) * fit.k < SMALL;
    if (small) {
      // 小さな絵：ラベルは絵の外（幅の線の下）に 1 行で
      const s = `${sizeLabel ? sizeLabel + ' / ' : ''}${wcm} × ${hcm} cm`;
      const cx = Math.min(Math.max((x0 + x1) / 2, textW(s) / 2 + 4 * u), iw - textW(s) / 2 - 4 * u);
      const below = wy + (TICK + 4) * u + font;
      label(s, cx, below <= ih - 2 * u ? below : y0 - 6 * u, 'middle');
      return;
    }
    // 幅のラベル：線の下。画像の外に出るなら線の上（内側）
    const wl = wy + (TICK + 4) * u + font;
    label(`${wcm} cm`, (x0 + x1) / 2, wl <= ih - 2 * u ? wl : wy - (TICK + 3) * u, 'middle');
    // 高さのラベル：線の右。画像の外に出るなら絵の左
    const hl = `${hcm} cm`;
    if (hx + (TICK + 4) * u + textW(hl) <= iw) label(hl, hx + (TICK + 4) * u, (y0 + y1) / 2, 'start', 'middle');
    else label(hl, x0 - 6 * u, (y0 + y1) / 2, 'end', 'middle');
    // 号数：絵の左上（上に入らなければ絵の内側）
    if (sizeLabel) {
      const ly = y0 - 6 * u;
      if (ly - font >= 0) label(sizeLabel, x0, ly, 'start'); else label(sizeLabel, x0 + 4 * u, y0 + font + 2 * u, 'start');
    }
  }

  function setDimsVisible(animateIn: boolean) {
    clearTimeout(dimsTimer);
    svg.classList.remove('on');
    if (!showDims) return;
    if (animateIn) dimsTimer = window.setTimeout(() => svg.classList.add('on'), 500);   // 画像を先に見せ、0.5 秒遅れて線
    else svg.classList.add('on');
  }

  // ---- 大きさ（画面に収まる最大）と拡大 ----
  function layout() {
    const room = rooms[index];
    const [iw, ih] = room.image_px || [img.naturalWidth || 16, img.naturalHeight || 10];
    const bw = media.clientWidth, bh = media.clientHeight;
    const k = Math.min(bw / iw, bh / ih);
    fit = { w: iw * k, h: ih * k, k };
    frame.style.width = `${fit.w}px`; frame.style.height = `${fit.h}px`;
    applyZoom();
    drawDims(room);
  }
  function clampPan() {
    const mx = (fit.w * (zoom - 1)) / 2, my = (fit.h * (zoom - 1)) / 2;
    tx = Math.min(mx, Math.max(-mx, tx)); ty = Math.min(my, Math.max(-my, ty));
  }
  function applyZoom() {
    clampPan();
    frame.style.transform = zoom === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${zoom})`;
    zoomBtn.setAttribute('aria-pressed', String(zoom > 1));
    media.classList.toggle('zoomed', zoom > 1);
  }
  // 画面の点 (px, py) を動かさずに拡大率を変える
  function zoomAt(z: number, px: number, py: number) {
    const r = media.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    const ux = (px - cx - tx) / zoom, uy = (py - cy - ty) / zoom;
    zoom = nz; tx = px - cx - nz * ux; ty = py - cy - nz * uy;
    if (zoom === 1) { tx = 0; ty = 0; }
    applyZoom();
  }
  // 絵の中心の画面座標
  function paintingCenter(): [number, number] {
    const q = rooms[index].quad_px; const r = frame.getBoundingClientRect();
    if (!q) return [r.left + r.width / 2, r.top + r.height / 2];
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    const s = r.width / (rooms[index].image_px?.[0] || 1);
    return [r.left + ((Math.min(...xs) + Math.max(...xs)) / 2) * s, r.top + ((Math.min(...ys) + Math.max(...ys)) / 2) * s];
  }

  function show(i: number) {
    index = (i + rooms.length) % rooms.length;
    zoom = 1; tx = 0; ty = 0;
    const room = rooms[index];
    svg.classList.remove('on');
    img.src = srcs[index] || '';
    renderText(room);
    layout();
    const ready = () => { layout(); setDimsVisible(true); };
    if (img.complete && img.naturalWidth) ready(); else img.addEventListener('load', ready, { once: true });
  }

  // ---- 操作 ----
  let dragged = false;
  let downTarget: EventTarget | null = null;   // ポインタを捕まえると click の target が変わるので、押した場所で判定する
  root.addEventListener('pointerdown', (e) => { downTarget = e.target; }, true);
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; z: number } | null = null;
  let start: { x: number; y: number; tx: number; ty: number } | null = null;
  media.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { media.setPointerCapture(e.pointerId); } catch {}
    dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom }; start = null;
    } else start = { x: e.clientX, y: e.clientY, tx, ty };
  });
  media.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      dragged = true;
      zoomAt(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 8) dragged = true;
      if (zoom > 1) { tx = start.tx + dx; ty = start.ty + dy; applyZoom(); }
    }
  });
  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    // 拡大していないときの横のスワイプで、他の部屋へ
    if (start && zoom === 1 && !pinch) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && rooms.length > 1) show(index + (dx < 0 ? 1 : -1));
    }
    if (pointers.size < 2) pinch = null;
    start = null;
  };
  media.addEventListener('pointerup', up);
  media.addEventListener('pointercancel', up);
  media.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(zoom * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY); }, { passive: false });
  frame.addEventListener('dblclick', (e) => { zoomAt(zoom > 1 ? 1 : MAX_ZOOM, e.clientX, e.clientY); });
  // 背景のタップで閉じる（画像や文章の上では閉じない）
  root.addEventListener('click', (e) => { const tg = downTarget ?? e.target; if (!dragged && (tg === root || tg === media)) dispose(); });
  close.addEventListener('click', () => dispose());
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  toggle.addEventListener('click', () => { showDims = !showDims; renderText(rooms[index]); setDimsVisible(false); });
  zoomBtn.addEventListener('click', () => { const [px, py] = paintingCenter(); zoomAt(zoom > 1 ? 1 : MAX_ZOOM, px, py); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); dispose(); }
    else if (e.key === 'ArrowLeft' && rooms.length > 1) show(index - 1);
    else if (e.key === 'ArrowRight' && rooms.length > 1) show(index + 1);
    else if (e.key === 'Tab') {
      // フォーカスを拡大表示の中に留める
      const f = [...root.querySelectorAll<HTMLElement>('button:not([hidden])')];
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const onResize = () => { layout(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true;
    clearTimeout(dimsTimer);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.documentElement.style.overflow = prevOverflow;
    root.remove();
    o.returnFocus?.focus();
  }

  document.body.appendChild(root);
  show(index);
  close.focus();
  return dispose;
}
