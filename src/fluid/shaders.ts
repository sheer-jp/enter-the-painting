// 流体シムのシェーダ。領域は 2:1 の等距離円筒（横は繰り返し、縦は端で止める）
export const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const HASH = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { float h = hash12(p); return vec2(h, hash12(p + h + 17.1)); }
// 低周波ノイズ（向きの符号を決めるため）
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
`;

// 初期状態：色 = 絵（矩形内）+ 基調色のグラデーション（外側）
export const INIT_DYE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPainting;
uniform vec4 uRect;      // x, y, w, h（0〜1）
uniform vec3 uBack;
uniform vec3 uBack2;
void main() {
  vec2 p = (vUv - uRect.xy) / uRect.zw;
  vec3 back = mix(uBack2, uBack, smoothstep(0.0, 1.0, vUv.y));
  if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
    gl_FragColor = vec4(texture2D(uPainting, p).rgb, 1.0);
  } else {
    gl_FragColor = vec4(back, 1.0);
  }
}
`;

// 初期速度：筆致の流れ場（軸性）に符号をつける
export const INIT_VEL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uFlow;
uniform vec4 uRect;
uniform float uStrength;
${HASH}
void main() {
  vec2 p = (vUv - uRect.xy) / uRect.zw;
  vec2 v = vec2(0.0);
  if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
    vec3 f = texture2D(uFlow, p).rgb;
    vec2 dir = f.rg * 2.0 - 1.0;
    // 向きの符号は低周波ノイズで滑らかに決める（硬い境界を作らない）
    float s = (vnoise(p * 2.0) - 0.5) * 2.0;
    s = sign(s) * smoothstep(0.0, 0.35, abs(s));
    v = dir * f.b * s * uStrength;
  }
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`;

// 移流（半ラグランジュ）。uDt は texel 単位に換算済み
export const ADVECT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * uTexel;
  coord.y = clamp(coord.y, 0.0, 1.0);
  gl_FragColor = texture2D(uSource, coord) * (1.0 - uDissipation);
}
`;

// MacCormack の補正：phi = phiHat1 + 0.5 (phi0 - phiHat0)、近傍で clamp。さらに原画へ弱く回帰
export const MACCORMACK = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uPhi0;     // 元
uniform sampler2D uPhiHat1;  // 前進
uniform sampler2D uPhiHat0;  // 前進 → 後退
uniform sampler2D uOriginal; // 原画（回帰先）
uniform vec2 uTexel;
uniform float uDt;
uniform float uRestore;
void main() {
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 back = vUv - uDt * vel * uTexel;
  back.y = clamp(back.y, 0.0, 1.0);
  vec4 h1 = texture2D(uPhiHat1, vUv);
  vec4 h0 = texture2D(uPhiHat0, vUv);
  vec4 p0 = texture2D(uPhi0, vUv);
  vec4 r = h1 + 0.5 * (p0 - h0);
  // 後退位置の近傍 4 点で clamp（振動を抑える）
  vec2 st = back / uTexel - 0.5;
  vec2 i = floor(st), f = fract(st);
  vec2 b = (i + 0.5) * uTexel;
  vec4 a0 = texture2D(uPhi0, b), a1 = texture2D(uPhi0, b + vec2(uTexel.x, 0.0)), a2 = texture2D(uPhi0, b + vec2(0.0, uTexel.y)), a3 = texture2D(uPhi0, b + uTexel);
  vec4 mn = min(min(a0, a1), min(a2, a3)), mx = max(max(a0, a1), max(a2, a3));
  r = clamp(r, mn, mx);
  vec4 orig = texture2D(uOriginal, vUv);
  gl_FragColor = mix(r, orig, uRestore);
}
`;

export const CURL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

export const VORTICITY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCurlStrength;
uniform float uDt;
void main() {
  float L = texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy + force * uDt;
  gl_FragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
}
`;

export const DIVERGENCE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  float B = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  if (vUv.y + uTexel.y > 1.0) T = -texture2D(uVelocity, vUv).y;
  if (vUv.y - uTexel.y < 0.0) B = -texture2D(uVelocity, vUv).y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
`;

export const PRESSURE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}
`;

export const GRADIENT_SUBTRACT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  vec2 vel = texture2D(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B);
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

// 点の力（視線の引き寄せ、タッチ）
export const SPLAT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uValue;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 d = vUv - uPoint;
  d.x = min(abs(d.x), 1.0 - abs(d.x)) * sign(d.x);   // 横は繰り返し
  d.x *= uAspect;
  float g = exp(-dot(d, d) / uRadius);
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + uValue * g, 1.0);
}
`;

// シュワシュワ：絵の縁から内側へ進む帯の中に、細かいランダムな速度を打つ
export const FIZZ = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform vec4 uRect;
uniform float uProgress;   // 0〜1：縁 → 中心
uniform float uAmount;
uniform float uTime;
${HASH}
void main() {
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 p = (vUv - uRect.xy) / uRect.zw;
  if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
    // 縁からの距離（0 = 縁、1 = 中心）
    float e = 2.0 * min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
    float band = 1.0 - smoothstep(0.0, 0.22, abs(e - uProgress * 1.1));
    // 既に通り過ぎた所にも弱く残す
    float passed = (e < uProgress * 1.1) ? 0.25 : 0.0;
    float m = max(band, passed) * uAmount;
    vec2 cell = floor(vUv * vec2(240.0, 120.0) + uTime * 7.0);
    vec2 r = hash22(cell + uTime) * 2.0 - 1.0;
    vel += r * m * (0.5 + 0.5 * hash12(cell * 1.7 + uTime));
  }
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

// 表示用：色場の一部（絵の矩形）を画面に出す
export const DISPLAY = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uDye;
uniform vec4 uView;     // 表示する矩形 x, y, w, h（色場の UV）
void main() {
  vec2 uv = uView.xy + vUv * uView.zw;
  gl_FragColor = vec4(texture2D(uDye, uv).rgb, 1.0);
}
`;
