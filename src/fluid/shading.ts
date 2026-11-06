// 表示の質感（docs/FLUID_LOOK.md）：絵の具の厚みから法線を作り、拡散・鏡面・環境の映り込み・彩度・にじみ・粒子をかける。
// 物語モード（StoryMode の DISPLAY_FRAG）と VR（SpaceMode の MORPH_FRAG）の両方に ${SHADING} で埋め込む。
// アクリル：光沢は小さく鋭く、色は鮮やかさ優先。陰影は稜線の近くだけ、平らな所は原色のまま
import * as THREE from 'three';
import type { Fluid } from './Fluid';
import type { Look } from '../experience/types';

// 絵ごとの性格（docs/FLUID_PER_WORK.md 1 節）：swell 波打ち、dots 粒立ち、bleed にじみ。いずれも 0〜1、既定 0（表示側だけ）
export type PaintLook = Look & { swell: number; dots: number; bleed: number };
export const DEFAULT_LOOK: PaintLook = { relief: 0.5, gloss: 0.18, sharpness: 96, bloom: 0.04, grain: 0.02, vivid: 0.45, swell: 0, dots: 0, bleed: 0 };

// 物語モードの光：画面の左上やや手前
export const LIGHT_DIR = new THREE.Vector3(-0.4, 0.6, 0.7).normalize();

// 勾配の係数：厚みの差（テクセル 1 つ分）× relief × 厚みの高さ（テクセル）× これ。解像度によらず同じ傾きになる
const SLOPE_GAIN = 0.05;   // 0.025 では筆のあとの傾きが小さすぎ、陰影がほぼ出なかった（11-04 のスクリーンショット）

export const SHADING = /* glsl */ `
uniform sampler2D uDye;
uniform sampler2D uThick;
uniform vec2 uThickTexel;
uniform vec2 uDyeTexel;
uniform float uSlope;       // relief × 厚みの高さ × 係数
uniform float uRelief;
uniform float uGloss;
uniform float uSharpness;
uniform float uBloom;
uniform float uGrain;
uniform float uVividAmt;    // look.vivid
uniform float uVivid;       // 流れている度合い 0〜1
uniform float uTime;
uniform float uSwell;       // look.swell 波打ち 0〜1
uniform float uDots;        // look.dots 粒立ち 0〜1
uniform float uBleed;       // look.bleed にじみ 0〜1（sharpness を下げ bloom を上げる）
uniform float uReliefScale; // 厚みの陰影の倍率（既定 1）
uniform vec3 uLightWorld;   // 光の位置（uLightMode 1 のとき。下の 7 引数の paintShade の P と同じ空間）
uniform float uLightMode;   // 0：呼び出し側の L（ビュー空間固定）、1：uLightWorld から点への向き
float shadeHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// 粒立ち：厚みの山（relief の平均 0.3 付近より上）を丸く持ち上げる
float dotsLift(float t) { return t + uDots * 0.5 * smoothstep(0.4, 0.8, t); }
// uv は色場の座標。L・V はその点の接空間（x = u の向き、y = v の向き、z = 表面から見る人の側）
vec3 paintShade(vec2 uv, vec3 L, vec3 V) {
  vec3 base = texture2D(uDye, uv).rgb;
  // 法線：厚みの勾配
  float tl = dotsLift(texture2D(uThick, uv - vec2(uThickTexel.x, 0.0)).r);
  float tr = dotsLift(texture2D(uThick, uv + vec2(uThickTexel.x, 0.0)).r);
  float tb = dotsLift(texture2D(uThick, uv - vec2(0.0, uThickTexel.y)).r);
  float tt = dotsLift(texture2D(uThick, uv + vec2(0.0, uThickTexel.y)).r);
  float sl = uSlope * uReliefScale;
  vec2 g = vec2(-(tr - tl) * 0.5 * sl, -(tt - tb) * 0.5 * sl);
  // 波打ち：低周波の面の起伏（波長は高さの約 0.6、周期 12 秒と 9.7 秒）。傾きを解析的に足す（テクセル差では小さすぎて見えない）
  if (uSwell > 0.0) {
    float ph1 = 6.2832 * (uv.y / 0.6 + uv.x * 0.35 + uTime / 12.0);
    float ph2 = 6.2832 * (uv.x / 0.75 - uv.y * 0.3 - uTime / 9.7);
    g += uSwell * 0.45 * (vec2(0.35, 1.0) * cos(ph1) + vec2(1.0, -0.3) * 0.6 * cos(ph2));
  }
  vec3 n = normalize(vec3(g, 1.0));
  // にじみ：鏡面を広く、明るい所のにじみを強く（色そのものは拡散させない）
  float sharp = mix(uSharpness, uSharpness * 0.3, uBleed);
  float bloom = mix(uBloom, max(uBloom, 0.3), uBleed);
  float bloomCut = 0.6 - 0.3 * uBleed;
  // 稜線の近くだけ（平らな所は 0）
  float edge = smoothstep(0.0, 0.25, 1.0 - n.z);
  // 拡散：平らな面の明るさで割り、陰の側だけ暗く、光の側はわずかに明るく（平均を下げない）
  float flatLit = 0.78 + 0.22 * max(L.z, 0.0);
  float dif = (0.78 + 0.22 * max(dot(n, L), 0.0)) / flatLit;
  vec3 c = mix(base, base * dif, edge);
  float preMx = max(c.r, max(c.g, c.b)), preMn = min(c.r, min(c.g, c.b));
  float preSat = (preMx - preMn) / (preMx + 1e-4);
  // 環境：白い窓の光をごく薄く（光の側を向いた斜面だけ）
  vec2 win = normalize(L.xy + vec2(1e-5));
  c += vec3(0.04 * uRelief * clamp(dot(n.xy, win) * 2.0, 0.0, 1.0));   // 窓の光はごく薄く（白っぽく褪せるのを防ぐ）
  // にじみ：明るい所だけを 1 段ぼかして加える（4 点）
  if (bloom > 0.0) {
    vec2 o = uDyeTexel * (6.0 + 6.0 * uBleed);
    vec3 s = max(texture2D(uDye, uv + vec2(o.x, o.y)).rgb - bloomCut, 0.0) + max(texture2D(uDye, uv + vec2(-o.x, o.y)).rgb - bloomCut, 0.0)
           + max(texture2D(uDye, uv + vec2(o.x, -o.y)).rgb - bloomCut, 0.0) + max(texture2D(uDye, uv - o).rgb - bloomCut, 0.0);
    c += s * 0.25 * bloom * 2.5;
  }
  // 鮮やかさ最優先：映り込みとにじみで薄まった彩度を、明るさ（最大のチャンネル）を保ったまま元に戻す
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float want = mx * (1.0 - preSat);
  if (mn > want && mx - mn > 1e-4) c = mx - (mx - c) * ((mx - want) / (mx - mn));
  // 陰影の分を戻す
  c *= 1.0 + 0.05 * uRelief * edge;
  // 1 を超えた分はチャンネルごとに切らず、全体を縮める（切ると色が白っぽくなる）
  c /= max(1.0, max(c.r, max(c.g, c.b)));
  // 鏡面：小さく鋭いサテンの光（白）
  vec3 H = normalize(L + V);
  // 白に、下の色を 35% だけ混ぜる（白い粒で色が薄まって見えないように）。稜線だけ（平らな所には足さない）
  vec3 glint = mix(vec3(1.0), c / max(1e-4, max(c.r, max(c.g, c.b))), 0.35);
  c += glint * (pow(max(dot(n, H), 0.0), sharp) * uGloss * edge);
  // 彩度の補正（流れている間）：混ざって鈍った色を戻す
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.0 + uVividAmt * uVivid);
  c = (c - 0.5 * luma * uVivid * 0.1) * (1.0 + 0.08 * uVivid);
  // 粒子
  c += (shadeHash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * uGrain;
  return max(c, 0.0);
}
// 光の位置で照らす版：P は点の位置、T・B・N はその点の接空間の基底（uLightWorld と同じ空間）。
// uLightMode 1 のとき L を「点から uLightWorld への向き」に置き換える。0 なら 3 引数版と同じ
vec3 paintShade(vec2 uv, vec3 L, vec3 V, vec3 P, vec3 T, vec3 B, vec3 N) {
  if (uLightMode > 0.5) {
    vec3 d = normalize(uLightWorld - P);
    L = normalize(vec3(dot(d, T), dot(d, B), dot(d, N)));
  }
  return paintShade(uv, L, V);
}
`;

export function lookOf(look?: Partial<PaintLook>): PaintLook { return { ...DEFAULT_LOOK, ...(look || {}) }; }

// SHADING の uniform（流体と look から）。表示のマテリアルの uniforms に混ぜる
export function shadingUniforms(fluid: Fluid, look: Partial<PaintLook> & Look): Record<string, THREE.IUniform> {
  return {
    uDye: { value: fluid.texture }, uThick: { value: fluid.thickness },
    uThickTexel: { value: new THREE.Vector2() }, uDyeTexel: { value: new THREE.Vector2() }, uSlope: { value: 0 },
    uRelief: { value: look.relief }, uGloss: { value: look.gloss }, uSharpness: { value: look.sharpness },
    uBloom: { value: look.bloom }, uGrain: { value: look.grain }, uVividAmt: { value: look.vivid }, uVivid: { value: 0 }, uTime: { value: 0 },
    uSwell: { value: look.swell ?? 0 }, uDots: { value: look.dots ?? 0 }, uBleed: { value: look.bleed ?? 0 },
    uReliefScale: { value: 1 }, uLightWorld: { value: new THREE.Vector3() }, uLightMode: { value: 0 },
  };
}

// 毎フレーム：流体の今のテクスチャと大きさ（品質の変更や Double の入れ替えに追従）
export function updateShading(u: Record<string, THREE.IUniform>, fluid: Fluid, look: Partial<PaintLook> & Look, time: number, vivid: number) {
  const [tw, th] = fluid.thicknessSize, [dw, dh] = fluid.size;
  u.uDye.value = fluid.texture; u.uThick.value = fluid.thickness;
  (u.uThickTexel.value as THREE.Vector2).set(1 / tw, 1 / th);
  (u.uDyeTexel.value as THREE.Vector2).set(1 / dw, 1 / dh);
  u.uSlope.value = look.relief * th * SLOPE_GAIN;
  u.uTime.value = time; u.uVivid.value = vivid;
  if (u.uSwell) { u.uSwell.value = look.swell ?? 0; u.uDots.value = look.dots ?? 0; u.uBleed.value = look.bleed ?? 0; }
}
