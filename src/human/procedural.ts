// 体メッシュから手続き的に作る「体に沿う」衣類（Tシャツ・レギンス・下着・ニット帽など）。
//
// ベースメッシュ（モーフ前）上でスカラー場 f を定義し、f>0 の領域を三角形クリップで切り出す。
// 切り出した各頂点は「体の2頂点の線形補間」なので mhclo と同じ束縛表現になり、
// 以降のモーフ追従・スキニングは通常の Proxy と同じ経路で処理できる。
import type { BoneDef, CatalogItem, Pack, ProxyMeta } from './assets';

export interface ShellContext {
  basePos: Float32Array;
  nBody: number;
  /** 体の三角形（頂点index） */
  tris: Uint32Array;
  /** 頂点ごとのUV（継ぎ目では代表値） */
  vertUv: Float32Array;
  bones: BoneDef[];
  skinIndex: ArrayLike<number>;
  skinWeight: ArrayLike<number>;
  /** ベース形状での関節位置（ボーン名 → head） */
  joint(name: string): [number, number, number];
}

type V3 = [number, number, number];

interface Regions {
  armL: Float32Array; armR: Float32Array; legL: Float32Array; legR: Float32Array; head: Float32Array;
}

interface FieldEnv {
  r: Regions;
  J: Record<string, V3>;
  x: number; y: number; z: number; i: number;
  /** 腕に沿った位置。0=肩, 1=肘, 2=手首 */
  armT(side: 'L' | 'R'): number;
  /** 脚に沿った位置。0=股関節, 1=膝, 2=足首 */
  legT(side: 'L' | 'R'): number;
}

export interface ShellDef extends CatalogItem {
  slot: 'top' | 'bottom' | 'hat';
  /** 肌からの浮き [m] */
  offset: number;
  color: string;
  roughness?: number;
  field(e: FieldEnv): number;
  /** 帽子用: この平面より上の髪を隠す（ベース形状の座標系） */
  hairClip?: { point: V3; normal: V3 };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const OUT = -1;

interface TopOpts {
  hemY: number;
  neckR: number;
  /** 襟ぐりの中心を首の付け根から下・前へずらす量 */
  neckDrop?: number;
  /** 袖の長さ（armT 単位）。負なら袖なし */
  sleeve: number;
  armholeR?: number;
  /** これより下を切る（丈の短いトップ用） */
  cropY?: number;
}

function topField(o: TopOpts) {
  return (e: FieldEnv): number => {
    // 顎など頭部は対象外（襟ぐりの球より前に張り出しているため、距離だけでは除外できない）
    if (e.r.head[e.i] > 0.6) return OUT;
    const p: V3 = [e.x, e.y, e.z];
    let f = e.y - o.hemY;
    if (o.cropY !== undefined) f = Math.min(f, e.y - o.cropY);
    const drop = o.neckDrop ?? 0;
    const n = e.J['neck01'];
    const c: V3 = [0, n[1] + 0.012 - drop, n[2] + 0.012 + drop * 0.55];
    f = Math.min(f, len(sub(p, c)) - o.neckR, c[1] + 0.045 - e.y);
    for (const s of ['L', 'R'] as const) {
      const w = s === 'L' ? e.r.armL[e.i] : e.r.armR[e.i];
      if (o.sleeve < 0) {
        if (w > 0.5) f = Math.min(f, OUT);
        if ((s === 'L') === (e.x > 0)) f = Math.min(f, len(sub(p, e.J['upperarm01.' + s])) - (o.armholeR ?? 0.075));
      } else if (w > 0.5) {
        const upper = len(sub(e.J['lowerarm01.' + s], e.J['upperarm01.' + s]));
        f = Math.min(f, (o.sleeve - e.armT(s)) * upper);
      }
    }
    if (e.r.legL[e.i] > 0.5 || e.r.legR[e.i] > 0.5) f = Math.min(f, e.y - o.hemY);
    return f;
  };
}

interface BottomOpts {
  waistY: number;
  /** 裾の位置（legT 単位） */
  leg: number;
  /** ブリーフ型の脚ぐり（鼠径部に沿って斜めに切る） */
  highCut?: boolean;
}

function bottomField(o: BottomOpts) {
  return (e: FieldEnv): number => {
    let f = o.waistY - e.y;
    if (e.r.armL[e.i] > 0.3 || e.r.armR[e.i] > 0.3) return OUT;
    for (const s of ['L', 'R'] as const) {
      const w = s === 'L' ? e.r.legL[e.i] : e.r.legR[e.i];
      if (w > 0.5 && !o.highCut) {
        const upper = len(sub(e.J['lowerleg01.' + s], e.J['upperleg01.' + s]));
        f = Math.min(f, (o.leg - e.legT(s)) * upper);
      }
      if (o.highCut && (s === 'L') === (e.x >= 0)) {
        const hip = e.J['upperleg01.' + s];
        const sx = s === 'L' ? 1 : -1;
        // 股関節を通り外下へ向く平面の内側だけを残す
        const d = (e.x - hip[0]) * sx * 0.62 + (e.y - hip[1]) * -0.78;
        f = Math.min(f, -d - 0.004);
      }
    }
    return f;
  };
}

/** ニット帽: 額から後頭部へ傾いた平面より上の頭部を覆う。 */
const BEANIE_PLANE: { point: V3; normal: V3 } = { point: [0, 0.778, 0.13], normal: [0, 0.9, -0.43] };

export const SHELL_DEFS: ShellDef[] = [
  { id: 'proc_tshirt', label: 'フィットTシャツ', slot: 'top', offset: 0.004, color: '#e9e7e2', field: topField({ hemY: 0.085, neckR: 0.088, sleeve: 0.5 }) },
  { id: 'proc_longsleeve', label: '長袖インナー', slot: 'top', offset: 0.004, color: '#2b2f3a', field: topField({ hemY: 0.08, neckR: 0.085, sleeve: 1.93 }) },
  { id: 'proc_tank', label: 'タンクトップ', slot: 'top', offset: 0.004, color: '#f1f1ee', field: topField({ hemY: 0.09, neckR: 0.1, neckDrop: 0.035, sleeve: -1, armholeR: 0.082 }) },
  { id: 'proc_croptop', label: 'クロップトップ', slot: 'top', offset: 0.004, color: '#c9495a', field: topField({ hemY: 0.09, cropY: 0.275, neckR: 0.105, neckDrop: 0.04, sleeve: -1, armholeR: 0.08 }) },
  { id: 'proc_bra', label: 'スポーツブラ', slot: 'top', offset: 0.005, color: '#d9d5cf', field: topField({ hemY: 0.09, cropY: 0.325, neckR: 0.098, neckDrop: 0.04, sleeve: -1, armholeR: 0.07 }) },

  { id: 'proc_leggings', label: 'レギンス', slot: 'bottom', offset: 0.003, color: '#1c1d22', roughness: 0.6, field: bottomField({ waistY: 0.165, leg: 1.9 }) },
  { id: 'proc_capri', label: '七分丈スパッツ', slot: 'bottom', offset: 0.003, color: '#2d3446', roughness: 0.6, field: bottomField({ waistY: 0.16, leg: 1.4 }) },
  { id: 'proc_shorts', label: 'ショートスパッツ', slot: 'bottom', offset: 0.0035, color: '#30343c', field: bottomField({ waistY: 0.15, leg: 0.42 }) },
  { id: 'proc_trunks', label: 'ボクサーパンツ', slot: 'bottom', offset: 0.003, color: '#3a3f4b', field: bottomField({ waistY: 0.125, leg: 0.2 }) },
  { id: 'proc_briefs', label: 'ショーツ', slot: 'bottom', offset: 0.003, color: '#d9d5cf', field: bottomField({ waistY: 0.105, leg: 0, highCut: true }) },

  {
    id: 'proc_beanie', label: 'ニット帽', slot: 'hat', offset: 0.011, color: '#8a2f35', roughness: 1, hairClip: BEANIE_PLANE,
    field: (e) => (e.r.head[e.i] > 0.5 ? dot(sub([e.x, e.y, e.z], BEANIE_PLANE.point), BEANIE_PLANE.normal) / len(BEANIE_PLANE.normal) : OUT),
  },
];

/** 既製の帽子（中折れ帽）をかぶったときに髪を隠す平面。 */
export const FEDORA_HAIR_CLIP: { point: V3; normal: V3 } = { point: [0, 0.772, 0.12], normal: [0, 0.97, -0.24] };

export class ShellFactory {
  private regions: Regions;
  private joints: Record<string, V3> = {};

  constructor(private readonly ctx: ShellContext) {
    const { bones } = ctx;
    const descendants = (rootName: string): Set<number> => {
      const set = new Set<number>();
      bones.forEach((b, i) => {
        if (b.name === rootName || (b.parent >= 0 && set.has(b.parent))) set.add(i);
      });
      return set;
    };
    const n = ctx.basePos.length / 3;
    const sum = (set: Set<number>): Float32Array => {
      const out = new Float32Array(n);
      for (let v = 0; v < n; v++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (set.has(ctx.skinIndex[v * 4 + k])) w += ctx.skinWeight[v * 4 + k];
        out[v] = w;
      }
      return out;
    };
    this.regions = {
      armL: sum(descendants('upperarm01.L')), armR: sum(descendants('upperarm01.R')),
      legL: sum(descendants('upperleg01.L')), legR: sum(descendants('upperleg01.R')),
      head: sum(descendants('neck02')),
    };
    for (const b of bones) this.joints[b.name] = ctx.joint(b.name);
  }

  build(def: ShellDef): Pack<ProxyMeta> {
    const { basePos, nBody, tris, vertUv } = this.ctx;
    const J = this.joints;
    const along = (p: V3, a: V3, b: V3) => {
      const ab = sub(b, a);
      return dot(sub(p, a), ab) / dot(ab, ab);
    };
    const env: FieldEnv = {
      r: this.regions, J, x: 0, y: 0, z: 0, i: 0,
      armT(s) {
        const p: V3 = [this.x, this.y, this.z];
        const tf = along(p, J['lowerarm01.' + s], J['wrist.' + s]);
        return tf > 0 ? 1 + tf : along(p, J['upperarm01.' + s], J['lowerarm01.' + s]);
      },
      legT(s) {
        const p: V3 = [this.x, this.y, this.z];
        const tf = along(p, J['lowerleg01.' + s], J['foot.' + s]);
        return tf > 0 ? 1 + tf : along(p, J['upperleg01.' + s], J['lowerleg01.' + s]);
      },
    };
    const f = new Float32Array(nBody);
    for (let i = 0; i < nBody; i++) {
      env.i = i; env.x = basePos[i * 3]; env.y = basePos[i * 3 + 1]; env.z = basePos[i * 3 + 2];
      f[i] = def.field(env);
    }

    // 出力頂点: 元の頂点そのもの、または辺(a,b)上の f=0 の点
    const bindV: number[] = [];
    const bindW: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const whole = new Map<number, number>();
    const onEdge = new Map<number, number>();
    const vert = (a: number): number => {
      let k = whole.get(a);
      if (k === undefined) {
        k = bindV.length / 3;
        whole.set(a, k);
        bindV.push(a, a, a);
        bindW.push(1, 0, 0);
        uv.push(vertUv[a * 2], vertUv[a * 2 + 1]);
      }
      return k;
    };
    const cut = (a: number, b: number): number => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const key = lo * 20000 + hi;
      let k = onEdge.get(key);
      if (k === undefined) {
        const t = f[lo] / (f[lo] - f[hi]);
        k = bindV.length / 3;
        onEdge.set(key, k);
        bindV.push(lo, hi, lo);
        bindW.push(1 - t, t, 0);
        uv.push(vertUv[lo * 2] * (1 - t) + vertUv[hi * 2] * t, vertUv[lo * 2 + 1] * (1 - t) + vertUv[hi * 2 + 1] * t);
      }
      return k;
    };
    for (let t = 0; t < tris.length; t += 3) {
      const v = [tris[t], tris[t + 1], tris[t + 2]];
      const inside = v.map((a) => f[a] > 0);
      const count = +inside[0] + +inside[1] + +inside[2];
      if (count === 0) continue;
      if (count === 3) {
        index.push(vert(v[0]), vert(v[1]), vert(v[2]));
        continue;
      }
      // 巡回順を保ったまま、内側の頂点と辺上の交点で多角形を作る
      const poly: number[] = [];
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3];
        if (inside[k]) poly.push(vert(a));
        if (inside[k] !== inside[(k + 1) % 3]) poly.push(cut(a, b));
      }
      for (let k = 1; k + 1 < poly.length; k++) index.push(poly[0], poly[k], poly[k + 1]);
    }
    const n = bindV.length / 3;
    const rv2v = new Uint32Array(n);
    for (let i = 0; i < n; i++) rv2v[i] = i;
    return {
      meta: {
        id: def.id, vertexCount: n, scale: { x: null, y: null, z: null },
        material: { diffuse: null, normal: null, ao: null, transparent: false, doubleSided: true },
        normalOffset: def.offset, defaultColor: def.color, roughness: def.roughness, hairClip: def.hairClip,
      },
      arrays: {
        bindV: Uint16Array.from(bindV), bindW: Float32Array.from(bindW), bindOff: new Float32Array(n * 3),
        rv2v, uv: Float32Array.from(uv), index: Uint32Array.from(index), deleteVerts: new Uint16Array(0),
      },
    };
  }
}
