import * as THREE from 'three';
import type { Pack, ProxyMeta } from './assets';
import { computeVertexNormals } from './morph';

/**
 * mhclo 形式のフィッティング。各頂点はベースメッシュ3頂点の重心重み + 軸別スケール付きオフセットで定義される。
 * tools/build-assets.mjs の fitProxy と同じ式。
 */
export function fitProxyPositions(
  verts: Float32Array,
  bindV: ArrayLike<number>,
  bindW: ArrayLike<number>,
  bindOff: ArrayLike<number>,
  scale: ProxyMeta['scale'],
  out: Float32Array,
): void {
  const axes = ['x', 'y', 'z'] as const;
  const sc = axes.map((ax, k) => {
    const s = scale[ax];
    return s ? Math.abs(verts[s.v1 * 3 + k] - verts[s.v2 * 3 + k]) / s.den : 1;
  });
  const n = out.length / 3;
  for (let i = 0; i < n; i++) {
    const a = bindV[i * 3] * 3, b = bindV[i * 3 + 1] * 3, c = bindV[i * 3 + 2] * 3;
    const wa = bindW[i * 3], wb = bindW[i * 3 + 1], wc = bindW[i * 3 + 2];
    for (let k = 0; k < 3; k++) {
      out[i * 3 + k] = wa * verts[a + k] + wb * verts[b + k] + wc * verts[c + k] + bindOff[i * 3 + k] * sc[k];
    }
  }
}

/** ベースメッシュのスキンウェイトを、束縛先3頂点の重心重みで混ぜて転写する（上位4ボーン）。 */
export function transferSkin(
  count: number,
  bindV: ArrayLike<number>,
  bindW: ArrayLike<number>,
  baseIndex: ArrayLike<number>,
  baseWeight: ArrayLike<number>,
): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const acc = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    acc.clear();
    for (let j = 0; j < 3; j++) {
      // 三角形の外側にある頂点は重心重みが負になる。負のスキンウェイトは破綻するので0に丸める
      const w = Math.max(0, bindW[i * 3 + j]);
      if (w === 0) continue;
      const bv = bindV[i * 3 + j] * 4;
      for (let k = 0; k < 4; k++) {
        const bw = baseWeight[bv + k];
        if (bw > 0) acc.set(baseIndex[bv + k], (acc.get(baseIndex[bv + k]) ?? 0) + w * bw);
      }
    }
    const top = [...acc.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    top.forEach(([bone, w], k) => {
      skinIndex[i * 4 + k] = bone;
      skinWeight[i * 4 + k] = w / sum;
    });
  }
  return { skinIndex, skinWeight };
}

/** ベースメッシュに追従するメッシュ（服・髪・目など）。 */
export class Proxy {
  readonly id: string;
  readonly meta: ProxyMeta;
  readonly mesh: THREE.SkinnedMesh;
  readonly geometry = new THREE.BufferGeometry();
  /** フィット後の頂点位置（レスト姿勢, 溶接済み頂点） */
  readonly positions: Float32Array;
  readonly skinIndex: Uint16Array;
  readonly skinWeight: Float32Array;
  readonly deleteVerts: Uint16Array;
  private readonly normals: Float32Array;
  private readonly tris: Uint32Array;
  private readonly rv2v: Uint32Array;
  /** 各頂点が束縛されているベースメッシュの3頂点 */
  readonly bindV: Uint16Array;
  private readonly bindW: Float32Array;
  private readonly bindOff: Float32Array;

  constructor(pack: Pack<ProxyMeta>, baseSkinIndex: ArrayLike<number>, baseSkinWeight: ArrayLike<number>, material: THREE.Material) {
    this.meta = pack.meta;
    this.id = pack.meta.id;
    const a = pack.arrays;
    this.bindV = a.bindV as Uint16Array;
    this.bindW = a.bindW as Float32Array;
    this.bindOff = a.bindOff as Float32Array;
    this.rv2v = a.rv2v as Uint32Array;
    this.deleteVerts = a.deleteVerts as Uint16Array;
    const n = pack.meta.vertexCount;
    this.positions = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    const index = a.index as Uint32Array;
    this.tris = new Uint32Array(index.length);
    for (let i = 0; i < index.length; i++) this.tris[i] = this.rv2v[index[i]];

    const skin = transferSkin(n, this.bindV, this.bindW, baseSkinIndex, baseSkinWeight);
    this.skinIndex = skin.skinIndex;
    this.skinWeight = skin.skinWeight;

    const rn = this.rv2v.length;
    const rSkinIndex = new Uint16Array(rn * 4);
    const rSkinWeight = new Float32Array(rn * 4);
    for (let r = 0; r < rn; r++) {
      const v = this.rv2v[r] * 4;
      for (let k = 0; k < 4; k++) {
        rSkinIndex[r * 4 + k] = skin.skinIndex[v + k];
        rSkinWeight[r * 4 + k] = skin.skinWeight[v + k];
      }
    }
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rn * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(rn * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(a.uv as Float32Array, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(rSkinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(rSkinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(index, 1));

    this.mesh = new THREE.SkinnedMesh(g, material);
    this.mesh.name = this.id;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /** 肌の上に最低限確保するすき間 [m]。0 なら押し出しをしない */
  minGap = 0;

  /**
   * モーフ後のベース頂点に合わせて形状を更新する。
   * @param bodyNormals ベース頂点の法線。minGap > 0 のとき、肌より内側に入った頂点を外へ押し出すのに使う
   */
  fit(verts: Float32Array, bodyNormals?: Float32Array): void {
    fitProxyPositions(verts, this.bindV, this.bindW, this.bindOff, this.meta.scale, this.positions);
    if (this.minGap > 0 && bodyNormals) this.pushOut(verts, bodyNormals);
    computeVertexNormals(this.positions, this.tris, this.normals);
    const lift = this.meta.normalOffset;
    if (lift) {
      for (let i = 0; i < this.positions.length; i++) this.positions[i] += this.normals[i] * lift;
    }
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    expand(this.positions, this.rv2v, pos.array as Float32Array);
    expand(this.normals, this.rv2v, nor.array as Float32Array);
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  /** partition() で分離した部分を描く2枚目のメッシュ（頂点属性は本体と共有） */
  overlay?: THREE.SkinnedMesh;

  /**
   * pred(u, v)（UV重心で判定）が真の三角形を別メッシュ overlay に分離し、別マテリアルで描けるようにする。
   * マテリアル配列＋グループにしないのは、パストレーサがマテリアル配列を正しく扱えないため。
   */
  partition(pred: (u: number, v: number) => boolean, overlayMaterial: THREE.Material): void {
    const index = this.geometry.getIndex()!.array as Uint32Array;
    const uv = this.geometry.getAttribute('uv').array as Float32Array;
    const a: number[] = [];
    const b: number[] = [];
    for (let t = 0; t < index.length; t += 3) {
      const i0 = index[t], i1 = index[t + 1], i2 = index[t + 2];
      const u = (uv[i0 * 2] + uv[i1 * 2] + uv[i2 * 2]) / 3;
      const v = (uv[i0 * 2 + 1] + uv[i1 * 2 + 1] + uv[i2 * 2 + 1]) / 3;
      (pred(u, v) ? b : a).push(i0, i1, i2);
    }
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(a), 1));
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) g.setAttribute(name, this.geometry.getAttribute(name));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(b), 1));
    this.overlay = new THREE.SkinnedMesh(g, overlayMaterial);
    this.overlay.name = this.id + ':overlay';
    this.overlay.frustumCulled = false;
  }

  /**
   * 体型によっては服が肌にめり込む（例: 細身用の襟に太い首）。
   * 各頂点を、束縛先の三角形上の点から法線方向に minGap 以上離れるよう押し出す。
   */
  private pushOut(verts: Float32Array, normals: Float32Array): void {
    const { bindV, bindW, positions: p, minGap } = this;
    for (let i = 0; i < p.length / 3; i++) {
      const a = bindV[i * 3] * 3, b = bindV[i * 3 + 1] * 3, c = bindV[i * 3 + 2] * 3;
      const wa = bindW[i * 3], wb = bindW[i * 3 + 1], wc = bindW[i * 3 + 2];
      let nx = wa * normals[a] + wb * normals[b] + wc * normals[c];
      let ny = wa * normals[a + 1] + wb * normals[b + 1] + wc * normals[c + 1];
      let nz = wa * normals[a + 2] + wb * normals[b + 2] + wc * normals[c + 2];
      const l = Math.hypot(nx, ny, nz);
      // 補助ジオメトリ（スカート用ヘルパー等）に束縛された頂点は法線が無いので対象外
      if (l < 0.5) continue;
      nx /= l; ny /= l; nz /= l;
      const d =
        (p[i * 3] - (wa * verts[a] + wb * verts[b] + wc * verts[c])) * nx +
        (p[i * 3 + 1] - (wa * verts[a + 1] + wb * verts[b + 1] + wc * verts[c + 1])) * ny +
        (p[i * 3 + 2] - (wa * verts[a + 2] + wb * verts[b + 2] + wc * verts[c + 2])) * nz;
      if (d < minGap) {
        const k = minGap - d;
        p[i * 3] += nx * k; p[i * 3 + 1] += ny * k; p[i * 3 + 2] += nz * k;
      }
    }
  }

  /**
   * 束縛先のベース頂点がすべて hidden に含まれる三角形を描画から外す。
   * （例: 長ズボンの裾の内側に隠れるはずの靴下部分）
   */
  hideByBase(hidden: Uint8Array | null): void {
    this.fullIndex ??= (this.geometry.getIndex()!.array as Uint32Array).slice();
    const full = this.fullIndex;
    if (!hidden) {
      this.geometry.setIndex(new THREE.BufferAttribute(full.slice(), 1));
      return;
    }
    const gone = (r: number) => {
      const v = this.rv2v[r] * 3;
      return hidden[this.bindV[v]] && hidden[this.bindV[v + 1]] && hidden[this.bindV[v + 2]];
    };
    const out: number[] = [];
    for (let t = 0; t < full.length; t += 3) {
      if (gone(full[t]) && gone(full[t + 1]) && gone(full[t + 2])) continue;
      out.push(full[t], full[t + 1], full[t + 2]);
    }
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(out), 1));
  }

  private fullIndex?: Uint32Array;

  /**
   * ベース形状にフィットさせたとき平面より上にある三角形を描画から外す（帽子の下の髪を隠す用途）。
   * 平面はベース形状の座標系で与える。null で解除。
   */
  setClip(basePos: Float32Array, plane: { point: number[]; normal: number[] } | null): void {
    this.fullIndex ??= (this.geometry.getIndex()!.array as Uint32Array).slice();
    const full = this.fullIndex;
    // 平面をまたぐ三角形はシェーダ側（clipDist > 0 を破棄）で切り、切り口を直線にする
    const dist = new Float32Array(this.rv2v.length).fill(-1);
    this.geometry.setAttribute('clipDist', new THREE.BufferAttribute(dist, 1));
    if (!plane) {
      this.geometry.setIndex(new THREE.BufferAttribute(full.slice(), 1));
      return;
    }
    const fitted = new Float32Array(this.positions.length);
    fitProxyPositions(basePos, this.bindV, this.bindW, this.bindOff, this.meta.scale, fitted);
    const nl = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]);
    for (let r = 0; r < dist.length; r++) {
      const v = this.rv2v[r] * 3;
      dist[r] = ((fitted[v] - plane.point[0]) * plane.normal[0] + (fitted[v + 1] - plane.point[1]) * plane.normal[1] + (fitted[v + 2] - plane.point[2]) * plane.normal[2]) / nl;
    }
    const out: number[] = [];
    for (let t = 0; t < full.length; t += 3) {
      if (dist[full[t]] > 0 && dist[full[t + 1]] > 0 && dist[full[t + 2]] > 0) continue;
      out.push(full[t], full[t + 1], full[t + 2]);
    }
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(out), 1));
  }

  dispose(): void {
    this.overlay?.geometry.dispose();
    this.geometry.dispose();
  }
}

/** 溶接済み頂点の属性を描画用頂点（UVの継ぎ目で複製されたもの）へ展開する。 */
export function expand(src: Float32Array, rv2v: ArrayLike<number>, out: Float32Array): void {
  for (let r = 0; r < rv2v.length; r++) {
    const v = rv2v[r] * 3;
    out[r * 3] = src[v]; out[r * 3 + 1] = src[v + 1]; out[r * 3 + 2] = src[v + 2];
  }
}
