// 表示の質感（docs/FLUID_LOOK.md）：絵の具の厚みから法線を作り、拡散・鏡面・環境の映り込み・彩度・にじみ・粒子をかける。
// 物語モード（StoryMode の DISPLAY_FRAG）と VR（SpaceMode の MORPH_FRAG）の両方に ${SHADING} で埋め込む。
// アクリル：光沢は小さく鋭く、色は鮮やかさ優先。陰影は稜線の近くだけ、平らな所は原色のまま
import * as THREE from 'three';
import type { Fluid } from './Fluid';
import type { Look } from '../experience/types';

export const DEFAULT_LOOK: Look = { relief: 0.5, gloss: 0.18, sharpness: 96, bloom: 0.08, grain: 0.02, vivid: 0.35 };

// 物語モードの光：画面の左上やや手前
export const LIGHT_DIR = new THREE.Vector3(-0.4, 0.6, 0.7).normalize();

// 勾配の係数：厚みの差（テクセル 1 つ分）× relief × 厚みの高さ（テクセル）× これ。解像度によらず同じ傾きになる
const SLOPE_GAIN = 0.025;

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
float shadeHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// uv は色場の座標。L・V はその点の接空間（x = u の向き、y = v の向き、z = 表面から見る人の側）
vec3 paintShade(vec2 uv, vec3 L, vec3 V) {
  vec3 base = texture2D(uDye, uv).rgb;
  // 法線：厚みの勾配
  float tl = texture2D(uThick, uv - vec2(uThickTexel.x, 0.0)).r;
  float tr = texture2D(uThick, uv + vec2(uThickTexel.x, 0.0)).r;
  float tb = texture2D(uThick, uv - vec2(0.0, uThickTexel.y)).r;
  float tt = texture2D(uThick, uv + vec2(0.0, uThickTexel.y)).r;
  vec3 n = normalize(vec3(-(tr - tl) * 0.5 * uSlope, -(tt - tb) * 0.5 * uSlope, 1.0));
  // 稜線の近くだけ（平らな所は 0）
  float edge = smoothstep(0.0, 0.25, 1.0 - n.z);
  // 拡散：平らな面の明るさで割り、陰の側だけ暗く、光の側はわずかに明るく（平均を下げない）
  float flatLit = 0.78 + 0.22 * max(L.z, 0.0);
  float dif = (0.78 + 0.22 * max(dot(n, L), 0.0)) / flatLit;
  vec3 c = mix(base, base * dif, edge);
  // 鏡面：小さく鋭いサテンの光（白）
  vec3 H = normalize(L + V);
  c += vec3(pow(max(dot(n, H), 0.0), uSharpness) * uGloss);
  // 環境：白い窓の光をごく薄く（光の側を向いた斜面だけ）
  vec2 win = normalize(L.xy + vec2(1e-5));
  c += vec3(0.08 * uRelief * clamp(dot(n.xy, win) * 2.0, 0.0, 1.0));
  // 鮮やかさ最優先：陰影の分を戻す
  c *= 1.0 + 0.05 * uRelief * edge;
  // 彩度の補正（流れている間）：混ざって鈍った色を戻す
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.0 + uVividAmt * uVivid);
  c = (c - 0.5 * luma * uVivid * 0.1) * (1.0 + 0.08 * uVivid);
  // にじみ：明るい所だけを 1 段ぼかして加える（4 点）
  if (uBloom > 0.0) {
    vec2 o = uDyeTexel * 6.0;
    vec3 s = max(texture2D(uDye, uv + vec2(o.x, o.y)).rgb - 0.6, 0.0) + max(texture2D(uDye, uv + vec2(-o.x, o.y)).rgb - 0.6, 0.0)
           + max(texture2D(uDye, uv + vec2(o.x, -o.y)).rgb - 0.6, 0.0) + max(texture2D(uDye, uv - o).rgb - 0.6, 0.0);
    c += s * 0.25 * uBloom * 2.5;
  }
  // 粒子
  c += (shadeHash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * uGrain;
  return max(c, 0.0);
}
`;

export function lookOf(look?: Partial<Look>): Look { return { ...DEFAULT_LOOK, ...(look || {}) }; }

// SHADING の uniform（流体と look から）。表示のマテリアルの uniforms に混ぜる
export function shadingUniforms(fluid: Fluid, look: Look): Record<string, THREE.IUniform> {
  return {
    uDye: { value: fluid.texture }, uThick: { value: fluid.thickness },
    uThickTexel: { value: new THREE.Vector2() }, uDyeTexel: { value: new THREE.Vector2() }, uSlope: { value: 0 },
    uRelief: { value: look.relief }, uGloss: { value: look.gloss }, uSharpness: { value: look.sharpness },
    uBloom: { value: look.bloom }, uGrain: { value: look.grain }, uVividAmt: { value: look.vivid }, uVivid: { value: 0 }, uTime: { value: 0 },
  };
}

// 毎フレーム：流体の今のテクスチャと大きさ（品質の変更や Double の入れ替えに追従）
export function updateShading(u: Record<string, THREE.IUniform>, fluid: Fluid, look: Look, time: number, vivid: number) {
  const [tw, th] = fluid.thicknessSize, [dw, dh] = fluid.size;
  u.uDye.value = fluid.texture; u.uThick.value = fluid.thickness;
  (u.uThickTexel.value as THREE.Vector2).set(1 / tw, 1 / th);
  (u.uDyeTexel.value as THREE.Vector2).set(1 / dw, 1 / dh);
  u.uSlope.value = look.relief * th * SLOPE_GAIN;
  u.uTime.value = time; u.uVivid.value = vivid;
}
