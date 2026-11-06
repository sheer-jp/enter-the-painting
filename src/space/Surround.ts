// 床と奥の光（docs/VR_DEPTH.md 1・3 節、V-3）。どちらも 1 ドローコール。
// 明るさの順：絵の層（正面）＞ 粒 ＞ 後ろの絵の層 ＞ 奥の光（絵の層の 1/3）＞ 床（1/4）
import * as THREE from 'three';

const FLOOR_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// 床：絵のぼかしの色を暗く映す。低周波のノイズで UV をずらしてゆっくり揺らす（水面の反射のように）
const FLOOR_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uVis;
uniform float uBright;
varying vec2 vUv;
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float t = uTime * 0.12;
  vec2 sway = vec2(sin(vUv.y * 5.1 + t * 1.3) + sin(vUv.x * 3.7 - t), cos(vUv.x * 4.3 + t * 1.1) + sin(vUv.y * 2.9 + t * 0.7)) * 0.025;
  // 足元から外へ、絵を上下反転して映す（反射）
  vec3 c = texture2D(uMap, vec2(vUv.x, 1.0 - vUv.y) + sway).rgb * uBright;
  float a = uVis * 0.8 * smoothstep(1.0, 0.55, r);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;

const BACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// 奥の光：絵のぼかしを球の内側に暗く。UV を 60 秒で 1 周、ゆっくり漂う
const BACK_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uVis;
uniform float uBright;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(vUv.x * 2.0 + uTime / 60.0, vUv.y + 0.04 * sin(uTime * 0.21 + vUv.x * 6.2832));
  vec3 c = texture2D(uMap, uv).rgb * uBright;
  gl_FragColor = vec4(c, uVis);
  #include <colorspace_fragment>
}
`;

export const FLOOR_BRIGHT = 0.25;      // 絵の層の 1/4
export const BACK_BRIGHT = 1 / 3;      // 絵の層の 1/3
export const BACK_RADIUS = 5;          // 4〜6m

export class Surround {
  readonly floor: THREE.Mesh;
  readonly back: THREE.Mesh;
  private floorMat: THREE.ShaderMaterial;
  private backMat: THREE.ShaderMaterial;

  constructor(private map: THREE.Texture) {
    map.wrapS = THREE.MirroredRepeatWrapping; map.wrapT = THREE.MirroredRepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, transparent: true, depthWrite: false,
      uniforms: { uMap: { value: map }, uTime: { value: 0 }, uVis: { value: 0 }, uBright: { value: FLOOR_BRIGHT } },
    });
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = 5;          // 絵の層の内側にあるので、絵の層の上に重ねる
    this.floor.frustumCulled = false;
    this.floor.visible = false;
    this.backMat = new THREE.ShaderMaterial({
      vertexShader: BACK_VERT, fragmentShader: BACK_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide,
      uniforms: { uMap: { value: map }, uTime: { value: 0 }, uVis: { value: 0 }, uBright: { value: BACK_BRIGHT } },
    });
    this.back = new THREE.Mesh(new THREE.SphereGeometry(BACK_RADIUS, 48, 24), this.backMat);
    this.back.renderOrder = -2;          // いちばん奥
    this.back.frustumCulled = false;
    this.back.visible = false;
  }

  // 球面になったときの頭の位置に合わせて置く。床は本当の床（y = 0）、半径は絵の層の内側に収まる大きさ
  place(head: THREE.Vector3, floorR: number) {
    this.floor.position.set(head.x, 0.005, head.z);
    this.floor.scale.setScalar(Math.max(0.001, floorR));
    this.back.position.copy(head);
  }

  update(time: number, vis: number) {
    this.floorMat.uniforms.uTime.value = time; this.floorMat.uniforms.uVis.value = vis;
    this.backMat.uniforms.uTime.value = time; this.backMat.uniforms.uVis.value = vis;
    this.floor.visible = vis > 0.001 && this.floor.scale.x > 0.01;
    this.back.visible = vis > 0.001;
  }

  dispose() { this.floor.geometry.dispose(); this.floorMat.dispose(); this.back.geometry.dispose(); this.backMat.dispose(); this.map.dispose(); }
}
