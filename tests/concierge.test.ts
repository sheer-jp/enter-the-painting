// 受付（E-1 / E-5）：合言葉の照合、上流の再試行、/api/recommend/config、光の色
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPassphrase, retryableStatus, fetchUpstream, onRequestPost } from '../functions/api/recommend.js';
import { onRequestGet } from '../functions/api/recommend/config.js';
import { glowColor } from '../src/concierge/index';

afterEach(() => { vi.restoreAllMocks(); });

describe('checkPassphrase', () => {
  it('期待値が空なら照合しない', () => {
    expect(checkPassphrase('', null)).toBe(true);
    expect(checkPassphrase(undefined, 'x')).toBe(true);
  });
  it('一致したときだけ通す', () => {
    expect(checkPassphrase('kanazawa', 'kanazawa')).toBe(true);
    expect(checkPassphrase('kanazawa', 'kanazaw')).toBe(false);
    expect(checkPassphrase('kanazawa', 'kanazawa2')).toBe(false);
    expect(checkPassphrase('kanazawa', '')).toBe(false);
    expect(checkPassphrase('kanazawa', null)).toBe(false);
  });
});

const req = (headers: Record<string, string> = {}) => new Request('https://example.com/api/recommend', {
  method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', 'CF-Connecting-IP': `ip-${Math.random()}`, ...headers },
  body: JSON.stringify({ lang: 'ja', messages: [{ role: 'user', content: '朝' }] }),
});

describe('POST /api/recommend の合言葉', () => {
  it('PASSPHRASE があって X-Passphrase が違えば 403 passphrase（値はログに出さない）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await onRequestPost({ request: req({ 'X-Passphrase': 'wrong' }), env: { PASSPHRASE: 'right-one' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'passphrase' });
    expect(JSON.stringify(err.mock.calls)).not.toContain('right-one');
    expect(JSON.stringify(err.mock.calls)).not.toContain('wrong');
  });
  it('ヘッダが無くても 403', async () => {
    const res = await onRequestPost({ request: req(), env: { PASSPHRASE: 'right-one' } });
    expect(res.status).toBe(403);
  });
  it('合っていれば合言葉の先へ進む（ここではカタログが無いので 502）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PASSPHRASE: 'right-one', ASSETS: { fetch: async () => new Response('no', { status: 404 }) } };
    const res = await onRequestPost({ request: req({ 'X-Passphrase': 'right-one' }), env });
    expect(res.status).toBe(502);
  });
});

describe('GET /api/recommend/config', () => {
  it('合言葉が要るかどうかだけを返す（値は返さない）、no-store', async () => {
    const on = onRequestGet({ env: { PASSPHRASE: 'secret-value' } });
    expect(on.headers.get('Cache-Control')).toBe('no-store');
    const body = await on.text();
    expect(JSON.parse(body)).toEqual({ passphrase: true });
    expect(body).not.toContain('secret-value');
    expect(await onRequestGet({ env: {} }).json()).toEqual({ passphrase: false });
    expect(await onRequestGet({ env: { PASSPHRASE: '' } }).json()).toEqual({ passphrase: false });
  });
});

describe('fetchUpstream（上流の一時的な失敗は 1 回だけ再試行）', () => {
  it('再試行する状態：429 / 5xx / 529', () => {
    for (const s of [429, 500, 502, 503, 529]) expect(retryableStatus(s)).toBe(true);
    for (const s of [200, 400, 401, 403, 404, 422]) expect(retryableStatus(s)).toBe(false);
  });
  it('529 のあと 200 なら 200（2 回呼ぶ）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 529 })).mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await fetchUpstream(f, 0);
    expect(r?.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('例外のあと例外なら null（2 回まで）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn().mockRejectedValue(new Error('net'));
    expect(await fetchUpstream(f, 0)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('400 は再試行しない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    expect((await fetchUpstream(f, 0))?.status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('2 回とも 503 なら最後の応答（呼び出し側が 502 にする）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn().mockImplementation(async () => new Response('x', { status: 503 }));
    expect((await fetchUpstream(f, 0))?.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('glowColor（ピカーンの光の色）', () => {
  it('主要色の色相のまま明るくする。白にはしない', () => {
    expect(glowColor('#df4f09')).toMatch(/^hsl\(20 85% 80%\)$/);
    expect(glowColor('#1d2b3a')).toMatch(/80%\)$/);
    expect(glowColor(undefined)).toMatch(/^hsl\(/);
    expect(glowColor('#ffffff')).toBe('hsl(0 0% 100%)');
  });
});
