// MakeHuman のテキスト形式（OBJ / target / mhclo / mhmat）のパーサ。
// 形式仕様とデータそのものに基づく独自実装（MakeHuman/MPFB のコードは参照していない）。

/**
 * Wavefront OBJ。面は多角形のまま返す（三角形化は呼び出し側）。
 * @param {string} text
 */
export function parseObj(text) {
  const v = [];
  const vt = [];
  /** @type {{v:number[], vt:number[], group:string}[]} */
  const faces = [];
  let group = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      v.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/);
      vt.push([+p[1], +p[2]]);
    } else if (line.startsWith('g ')) {
      group = line.slice(2).trim();
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      const fv = [];
      const fvt = [];
      for (const part of parts) {
        const [a, b] = part.split('/');
        fv.push(parseInt(a, 10) - 1);
        fvt.push(b ? parseInt(b, 10) - 1 : -1);
      }
      faces.push({ v: fv, vt: fvt, group });
    }
  }
  return { v, vt, faces };
}

/**
 * .target: 各行「頂点index dx dy dz」のスパース差分。
 * @param {string} text
 * @returns {{index:number[], delta:number[]}}
 */
export function parseTarget(text) {
  const index = [];
  const delta = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    if (p.length < 4) continue;
    index.push(parseInt(p[0], 10));
    delta.push(+p[1], +p[2], +p[3]);
  }
  return { index, delta };
}

/**
 * .mhclo / .proxy: 各頂点をベースメッシュの3頂点の重心重み + オフセットで束縛する。
 * @param {string} text
 */
export function parseMhclo(text) {
  const out = {
    name: '',
    objFile: '',
    material: '',
    /** @type {Record<'x'|'y'|'z', {v1:number, v2:number, den:number} | null>} */
    scale: { x: null, y: null, z: null },
    /** @type {{v:number[], w:number[], off:number[]}[]} */
    verts: [],
    /** @type {number[]} */
    deleteVerts: [],
  };
  let mode = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    const key = p[0];
    if (/^[a-zA-Z_]/.test(key)) {
      // 「verts 0」の直後に material 行が来るファイルがあるため、無関係なキーではモードを変えない
      if (key === 'name') out.name = p.slice(1).join(' ');
      else if (key === 'obj_file') out.objFile = p[1];
      else if (key === 'material') out.material = p[1];
      else if (key === 'x_scale' || key === 'y_scale' || key === 'z_scale') {
        out.scale[key[0]] = { v1: +p[1], v2: +p[2], den: +p[3] };
      } else if (key === 'verts') mode = 'verts';
      else if (key === 'delete_verts') mode = 'delete';
      else if (key === 'weights') mode = 'skip';
      continue;
    }
    if (mode === 'verts') {
      if (p.length === 1) {
        const i = +p[0];
        out.verts.push({ v: [i, i, i], w: [1, 0, 0], off: [0, 0, 0] });
      } else {
        out.verts.push({
          v: [+p[0], +p[1], +p[2]],
          w: [+p[3], +p[4], +p[5]],
          off: [+p[6], +p[7], +p[8]],
        });
      }
    } else if (mode === 'delete') {
      // 「a - b」の範囲指定と単独indexが混在する
      for (let i = 0; i < p.length; i++) {
        if (p[i + 1] === '-') {
          for (let k = +p[i]; k <= +p[i + 2]; k++) out.deleteVerts.push(k);
          i += 2;
        } else {
          out.deleteVerts.push(+p[i]);
        }
      }
    }
  }
  return out;
}

/**
 * .mhmat: 「key value...」の行形式。
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseMhmat(text) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const key = line.slice(0, sp);
    if (key === 'tag' || key === 'shaderParam' || key === 'shaderConfig') continue;
    out[key] = line.slice(sp + 1).trim();
  }
  return out;
}

/**
 * 面を三角形化し、(位置index, UV index) の組ごとに描画用頂点を作る。
 * @param {{v:number[], vt:number[]}[]} faces
 * @param {number[][]} vt
 */
export function buildRenderMesh(faces, vt) {
  const map = new Map();
  /** @type {number[]} */ const rv2v = [];
  /** @type {number[]} */ const uv = [];
  /** @type {number[]} */ const index = [];
  const rv = (vi, ti) => {
    const key = vi * 100000 + (ti + 1);
    let r = map.get(key);
    if (r === undefined) {
      r = rv2v.length;
      map.set(key, r);
      rv2v.push(vi);
      const t = ti >= 0 ? vt[ti] : [0, 0];
      uv.push(t[0], t[1]);
    }
    return r;
  };
  for (const f of faces) {
    const r = f.v.map((vi, k) => rv(vi, f.vt[k]));
    for (let k = 1; k + 1 < r.length; k++) index.push(r[0], r[k], r[k + 1]);
  }
  return { rv2v, uv, index };
}

/**
 * 面の接続だけで連結成分を求める。
 * @param {number} nVerts
 * @param {{v:number[]}[]} faces
 * @returns {Int32Array} 頂点ごとの成分代表
 */
export function connectedComponents(nVerts, faces) {
  const par = new Int32Array(nVerts);
  for (let i = 0; i < nVerts; i++) par[i] = i;
  const find = (i) => {
    while (par[i] !== i) {
      par[i] = par[par[i]];
      i = par[i];
    }
    return i;
  };
  for (const f of faces) {
    const a = find(f.v[0]);
    for (let k = 1; k < f.v.length; k++) {
      const b = find(f.v[k]);
      if (a !== b) par[b] = a;
    }
  }
  for (let i = 0; i < nVerts; i++) par[i] = find(i);
  return par;
}

/** 名前付き TypedArray を1つのバイナリにまとめる（4バイト境界に整列）。 */
export class BinPack {
  constructor() {
    /** @type {Buffer[]} */ this.chunks = [];
    this.offset = 0;
    /** @type {Record<string,{type:string, offset:number, length:number}>} */
    this.arrays = {};
  }
  /** @param {string} name @param {ArrayBufferView & {length:number}} arr */
  add(name, arr) {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    this.arrays[name] = { type: arr.constructor.name, offset: this.offset, length: arr.length };
    this.chunks.push(buf);
    this.offset += buf.length;
    const pad = (4 - (this.offset % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.offset += pad;
    }
  }
  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}
