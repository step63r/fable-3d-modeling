import * as THREE from 'three';
import { assetUrl } from '../human/assets';

const loader = new THREE.TextureLoader();
const imageCache = new Map<string, Promise<HTMLImageElement>>();
const textureCache = new Map<string, Promise<THREE.Texture>>();

export let maxAnisotropy = 8;
export function setMaxAnisotropy(n: number): void {
  maxAnisotropy = n;
}

export function loadImage(rel: string): Promise<HTMLImageElement> {
  let p = imageCache.get(rel);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像の読み込みに失敗: ' + rel));
      img.src = assetUrl(rel);
    });
    imageCache.set(rel, p);
  }
  return p;
}

function configure(tex: THREE.Texture, srgb: boolean): THREE.Texture {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function loadTexture(rel: string, srgb = true): Promise<THREE.Texture> {
  const key = rel + (srgb ? ':s' : ':l');
  let p = textureCache.get(key);
  if (!p) {
    p = loader.loadAsync(assetUrl(rel)).then((t) => configure(t, srgb));
    textureCache.set(key, p);
  }
  return p;
}

function toCanvas(img: HTMLImageElement, maxSize = 4096): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; data: ImageData } {
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  configure(tex, true);
  return tex;
}

/** 画像のアルファ値(0〜1)をUV座標で引く関数を返す。 */
export function alphaSampler(img: HTMLImageElement): (u: number, v: number) => number {
  const { data } = toCanvas(img, 512);
  const w = data.width, h = data.height;
  return (u, v) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h)));
    return data.data[(y * w + x) * 4 + 3] / 255;
  };
}

/** 不透明部分の平均色（sRGB, 0〜1）。 */
export function averageColor(img: HTMLImageElement): THREE.Color {
  const { data } = toCanvas(img, 64);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.data.length; i += 4) {
    if (data.data[i + 3] < 128) continue;
    r += data.data[i]; g += data.data[i + 1]; b += data.data[i + 2]; n++;
  }
  n = Math.max(1, n) * 255;
  return new THREE.Color().setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
}

/**
 * 髪・眉テクスチャを指定色に染め直す。元画像の明暗（毛流れ・ハイライト）は輝度として残す。
 * シェーダではなくテクスチャ側で行うのは、パストレーサでも同じ見た目にするため。
 */
export function tintedTexture(img: HTMLImageElement, color: string, opts: { contrast?: number; alphaGain?: number; maxGain?: number } = {}): THREE.CanvasTexture {
  const { canvas, ctx, data } = toCanvas(img, 2048);
  const d = data.data;
  const c = new THREE.Color(color);
  const cr = c.r, cg = c.g, cb = c.b; // 作業色空間（リニア）
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 32) continue;
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    n++;
  }
  const avg = n ? sum / n : 128;
  const contrast = opts.contrast ?? 1;
  const alphaGain = opts.alphaGain ?? 1;
  const out = new THREE.Color();
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / avg;
    // ハイライトが白飛びしないよう増幅には上限を設ける
    const k = Math.min(opts.maxGain ?? 1.7, Math.pow(l, contrast));
    // 明るい色ほどハイライトで白飛びしやすいので上限を抑える
    out.setRGB(Math.min(1, cr * k), Math.min(1, cg * k), Math.min(1, cb * k)).convertLinearToSRGB();
    d[i] = out.r * 255; d[i + 1] = out.g * 255; d[i + 2] = out.b * 255;
    if (alphaGain !== 1) d[i + 3] = Math.min(255, d[i + 3] * alphaGain);
  }
  ctx.putImageData(data, 0, 0);
  return canvasTexture(canvas);
}

/** 眼球テクスチャの虹彩部分（彩度の高い領域）だけを指定色に置き換える。 */
export function eyeTexture(img: HTMLImageElement, color: string): THREE.CanvasTexture {
  const { canvas, ctx, data } = toCanvas(img, 1024);
  const d = data.data;
  const target = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  target.getHSL(hsl, THREE.SRGBColorSpace);
  const px = new THREE.Color();
  const p = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    // 白目や血管（彩度が低い）は残し、虹彩（茶色で彩度が高い）だけを対象にする
    const m = Math.min(1, Math.max(0, (sat - 0.45) / 0.25));
    if (m <= 0) continue;
    px.setRGB(r, g, b, THREE.SRGBColorSpace).getHSL(p, THREE.SRGBColorSpace);
    // 元の虹彩の明暗模様（放射状の筋）を保ったまま色相・彩度・明るさを目標色へ寄せる
    const l = Math.min(1, p.l * (0.35 + hsl.l * 2.2));
    px.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), l, THREE.SRGBColorSpace);
    px.convertLinearToSRGB();
    d[i] = (r + (px.r - r) * m) * 255;
    d[i + 1] = (g + (px.g - g) * m) * 255;
    d[i + 2] = (b + (px.b - b) * m) * 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvasTexture(canvas);
}

/**
 * 肌マテリアル。リアルタイム描画では直接光の拡散項を「回り込み＋赤方向へのにじみ」で補正し、
 * 表皮下散乱（SSS）の見た目を近似する。
 */
export function createSkinMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0,
    specularIntensity: 0.45,
    sheen: 0.12,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0.9, 0.75, 0.68),
    bumpScale: 0.6,
  });
  mat.onBeforeCompile = (shader) => {
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'vec3 irradiance = dotNL * directLight.color;',
      `vec3 irradiance = dotNL * directLight.color;
	{
		// 散乱距離は赤が最も長い。チャンネルごとに回り込み量を変えると明暗境界が赤みを帯びる
		vec3 sssWrap = vec3( 0.45, 0.17, 0.09 );
		float rawNL = dot( geometryNormal, directLight.direction );
		vec3 wrapped = clamp( ( vec3( rawNL ) + sssWrap ) / ( 1.0 + sssWrap ), 0.0, 1.0 );
		reflectedLight.directDiffuse += ( wrapped - vec3( dotNL ) ) * directLight.color * BRDF_Lambert( material.diffuseColor ) * vec3( 1.0, 0.55, 0.42 );
	}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk);
  };
  mat.customProgramCacheKey = () => 'skin-sss';
  return mat;
}

export function createEyeMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ roughness: 0.25, metalness: 0, specularIntensity: 0.6, alphaTest: 0.5 });
}

export function createHairMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    roughness: 0.5,
    metalness: 0,
    specularIntensity: 0.35,
    sheen: 0.15,
    sheenRoughness: 0.5,
    side: THREE.DoubleSide,
    alphaTest: 0.35,
    alphaToCoverage: true,
  });
  // 帽子の下に隠れる髪を、頂点属性 clipDist（帽子の縁の平面からの距離）で切り落とす
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float clipDist;\nvarying float vClipDist;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClipDist = clipDist;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vClipDist;')
      .replace('void main() {', 'void main() {\nif ( vClipDist > 0.0 ) discard;');
  };
  mat.customProgramCacheKey = () => 'hair-clip';
  return mat;
}

/** 眉・まつ毛。細い線なのでアルファブレンドで描く。 */
export function createBrowMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    roughness: 0.7,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function createClothMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    roughness: 0.85,
    metalness: 0,
    sheen: 0.25,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0.5, 0.5, 0.5),
    side: THREE.DoubleSide,
  });
}

/**
 * 角膜の映り込み専用レイヤ。黒＋加算合成にすると拡散成分は0になり、鏡面反射だけが下の虹彩に重なる。
 */
export function createCorneaMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.03,
    // 環境全体の映り込みは抑え、ライトのキャッチライトを主体にする
    envMapIntensity: 0.3,
    specularIntensity: 1,
    ior: 1.376,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export function createTeethMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 });
}
