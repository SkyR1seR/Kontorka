// Материалы в духе PS1: плоское затенение, «дрожание» вершин (привязка к сетке экрана),
// освещение по зонам (у каждой комнаты свой свет), затемнение при отключении света
// и подсветка мониторами в темноте.
import * as THREE from 'three';
import { ZONES } from '../../shared/map.js';
import { tex } from './textures.js';

export const MAX_GLOW = 8;

export const U = {
  uZoneRect: { value: ZONES.map((z) => new THREE.Vector4(z.x0 - 0.2, z.z0 - 0.2, z.x1 + 0.2, z.z1 + 0.2)) },
  uZoneLum: { value: ZONES.map((z) => z.lum) },
  uZoneTint: { value: ZONES.map((z) => new THREE.Vector3(...z.light)) },
  uGlow: { value: Array.from({ length: MAX_GLOW }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uSnap: { value: new THREE.Vector2(240, 135) },
  uSnapOn: { value: 1 },
  uGlobalLum: { value: 1 },
};

const VERT_HEAD = `#include <common>
varying vec3 vWPos;
uniform vec2 uSnap;
uniform float uSnapOn;`;

const VERT_BODY = `#include <project_vertex>
#ifdef USE_INSTANCING
  vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
if (uSnapOn > 0.5) {
  vec4 sp = gl_Position;
  sp.xy = floor(sp.xy / sp.w * uSnap + 0.5) / uSnap * sp.w;
  gl_Position = sp;
}`;

const FRAG_HEAD = `#include <common>
varying vec3 vWPos;
uniform vec4 uZoneRect[${ZONES.length}];
uniform float uZoneLum[${ZONES.length}];
uniform vec3 uZoneTint[${ZONES.length}];
uniform vec4 uGlow[${MAX_GLOW}];
uniform float uGlobalLum;`;

const FRAG_BODY = `
{
  float zl = 1.0;
  vec3 zt = vec3(1.0);
  for (int i = 0; i < ${ZONES.length}; i++) {
    vec4 r = uZoneRect[i];
    if (vWPos.x >= r.x && vWPos.x <= r.z && vWPos.z >= r.y && vWPos.z <= r.w) { zl = uZoneLum[i]; zt = uZoneTint[i]; }
  }
  vec3 glow = vec3(0.0);
  for (int i = 0; i < ${MAX_GLOW}; i++) {
    vec4 gp = uGlow[i];
    if (gp.w > 0.0) {
      float d = distance(vWPos, gp.xyz);
      glow += vec3(0.42, 0.62, 1.0) * gp.w * clamp(1.0 - d / 3.4, 0.0, 1.0);
    }
  }
  gl_FragColor.rgb = gl_FragColor.rgb * zt * zl * uGlobalLum + diffuseColor.rgb * glow;
}
#include <tonemapping_fragment>`;

export function patchPS1(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uZoneRect = U.uZoneRect;
    shader.uniforms.uZoneLum = U.uZoneLum;
    shader.uniforms.uZoneTint = U.uZoneTint;
    shader.uniforms.uGlow = U.uGlow;
    shader.uniforms.uSnap = U.uSnap;
    shader.uniforms.uSnapOn = U.uSnapOn;
    shader.uniforms.uGlobalLum = U.uGlobalLum;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_HEAD)
      .replace('#include <project_vertex>', VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_HEAD)
      .replace('#include <tonemapping_fragment>', FRAG_BODY);
  };
  mat.customProgramCacheKey = () => 'ps1';
  return mat;
}

// Только дрожание вершин (для «светящихся» материалов: экраны, лампы)
export function patchSnapOnly(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = U.uSnap;
    shader.uniforms.uSnapOn = U.uSnapOn;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_HEAD)
      .replace('#include <project_vertex>', VERT_BODY);
  };
  mat.customProgramCacheKey = () => 'ps1snap';
  return mat;
}

const matCache = new Map();

export function lambert(opts = {}) {
  const key = JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const p = { flatShading: true };
  if (opts.color) p.color = new THREE.Color(opts.color);
  if (opts.tex) p.map = tex(opts.tex, opts.rx || 1, opts.ry || 1);
  if (opts.transparent) { p.transparent = true; p.opacity = opts.opacity ?? 0.5; p.depthWrite = false; }
  if (opts.side === 'double') p.side = THREE.DoubleSide;
  if (opts.emissive) p.emissive = new THREE.Color(opts.emissive);
  if (opts.emissiveMap && p.map) p.emissiveMap = p.map;
  const m = patchPS1(new THREE.MeshLambertMaterial(p));
  matCache.set(key, m);
  return m;
}

export function basic(opts = {}) {
  const key = 'b' + JSON.stringify(opts);
  if (matCache.has(key) && !opts.unique) return matCache.get(key);
  const p = {};
  if (opts.color) p.color = new THREE.Color(opts.color);
  if (opts.tex) p.map = tex(opts.tex);
  if (opts.map) p.map = opts.map;
  if (opts.transparent) { p.transparent = true; p.opacity = opts.opacity ?? 0.5; p.depthWrite = false; }
  if (opts.side === 'double') p.side = THREE.DoubleSide;
  const m = patchSnapOnly(new THREE.MeshBasicMaterial(p));
  if (!opts.unique) matCache.set(key, m);
  return m;
}

// Уникальный ламбертовский материал (для персонажей и изменяемых объектов)
export function lambertUnique(color, extra = {}) {
  return patchPS1(new THREE.MeshLambertMaterial({ color: new THREE.Color(color), flatShading: true, ...extra }));
}
