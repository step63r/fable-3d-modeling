// public/assets に変換済みのアセットを読み込む

type TypedArray = Float32Array | Uint32Array | Uint16Array | Int16Array | Uint8Array;
const CTORS: Record<string, { new (b: ArrayBuffer, o: number, l: number): TypedArray }> = {
  Float32Array, Uint32Array, Uint16Array, Int16Array, Uint8Array,
};

export interface Pack<M = Record<string, unknown>> {
  meta: M;
  arrays: Record<string, TypedArray>;
}

const BASE = `${import.meta.env.BASE_URL}assets/`;
export const assetUrl = (rel: string) => BASE + rel;

export async function loadPack<M = Record<string, unknown>>(rel: string): Promise<Pack<M>> {
  const [metaRes, binRes] = await Promise.all([fetch(assetUrl(rel + '.json')), fetch(assetUrl(rel + '.bin'))]);
  if (!metaRes.ok || !binRes.ok) throw new Error(`アセットの読み込みに失敗: ${rel}（先に pnpm assets を実行してください）`);
  const meta = await metaRes.json();
  const bin = await binRes.arrayBuffer();
  const arrays: Record<string, TypedArray> = {};
  for (const [name, a] of Object.entries(meta.arrays as Record<string, { type: string; offset: number; length: number }>)) {
    arrays[name] = new CTORS[a.type](bin, a.offset, a.length);
  }
  return { meta, arrays };
}

export interface CatalogItem {
  id: string;
  label: string;
  thumb?: string | null;
  gender?: 'female' | 'male';
  full?: boolean;
}
export interface SkinEntry {
  id: string;
  age: 'young' | 'middleage' | 'old';
  race: 'african' | 'asian' | 'caucasian';
  gender: 'female' | 'male';
  variant: number;
  texture: string;
}
export interface Catalog {
  hair: CatalogItem[];
  eyebrows: CatalogItem[];
  eyelashes: CatalogItem[];
  tops: CatalogItem[];
  bottoms: CatalogItem[];
  shoes: CatalogItem[];
  hats: CatalogItem[];
  glasses: CatalogItem[];
  skins: SkinEntry[];
  eyeTextures: { id: string; texture: string }[];
  hdri: { id: string; file: string }[];
}

export async function loadCatalog(): Promise<Catalog> {
  const res = await fetch(assetUrl('catalog.json'));
  if (!res.ok) throw new Error('catalog.json が見つかりません。先に `pnpm assets` を実行してください。');
  return res.json();
}

export interface BoneEnd {
  cube?: string;
  verts?: number[];
}
export interface BoneDef {
  name: string;
  parent: number;
  head: BoneEnd;
  tail: BoneEnd;
}
export interface BaseMeta {
  vertexCount: number;
  bodyVertexCount: number;
  jointCubes: Record<string, number[]>;
}
export interface RigMeta {
  bones: BoneDef[];
}
export interface TargetsMeta {
  quant: number;
  targets: Record<string, [number, number]>;
}
export interface ProxyMeta {
  id: string;
  vertexCount: number;
  scale: Record<'x' | 'y' | 'z', { v1: number; v2: number; den: number } | null>;
  material: { diffuse: string | null; normal: string | null; ao: string | null; transparent: boolean; doubleSided: boolean };
  /** 手続き生成の衣類用: フィット後に法線方向へ浮かせる量 [m] */
  normalOffset?: number;
  defaultColor?: string;
  roughness?: number;
  /** 帽子用: この平面より上の髪を隠す（ベース形状の座標系） */
  hairClip?: { point: [number, number, number]; normal: [number, number, number] };
}
