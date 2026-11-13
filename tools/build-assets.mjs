// assets-src/ のCC0アセットを、ブラウザ実行時に読みやすい JSON + バイナリへ変換する。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseObj, parseTarget, parseMhclo, parseMhmat, buildRenderMesh, connectedComponents, BinPack } from './lib/parsers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MPFB = path.join(root, 'assets-src/mpfb2/src/mpfb/data');
const SYS = path.join(root, 'assets-src/system_assets');
const OUT = path.join(root, 'public/assets');

// MakeHuman の座標はデシメートル。実行時はメートルで扱う
const UNIT = 0.1;
// ターゲット差分の量子化単位 [m]。身長ターゲットは足先が0.7m以上動くため、int16 で ±1.6m まで表現できる粒度にする
const TARGET_QUANT = 1 / 20000;

if (!existsSync(MPFB) || !existsSync(SYS)) {
  console.error('assets-src が見つかりません。先に `pnpm assets:fetch` を実行してください。');
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
for (const d of ['', 'proxies', 'tex', 'thumbs', 'hdri']) mkdirSync(path.join(OUT, d), { recursive: true });

const writeJson = (rel, obj) => writeFileSync(path.join(OUT, rel), JSON.stringify(obj));
function writePack(rel, pack, meta) {
  writeFileSync(path.join(OUT, rel + '.bin'), pack.toBuffer());
  writeJson(rel + '.json', { ...meta, arrays: pack.arrays });
}

// ---------------------------------------------------------------- base mesh
console.log('base mesh');
const baseObj = parseObj(readFileSync(path.join(MPFB, '3dobjs/base.obj'), 'utf8'));
const nBase = baseObj.v.length;
const basePos = new Float32Array(nBase * 3);
baseObj.v.forEach((p, i) => basePos.set([p[0] * UNIT, p[1] * UNIT, p[2] * UNIT], i * 3));

const bodyFaces = baseObj.faces.filter((f) => f.group === 'body');
const bodyMesh = buildRenderMesh(bodyFaces, baseObj.vt);
let nBody = 0;
for (const f of bodyFaces) for (const v of f.v) nBody = Math.max(nBody, v + 1);

/** @type {Record<string, number[]>} */
const jointCubes = {};
for (const f of baseObj.faces) {
  if (!f.group.startsWith('joint-')) continue;
  const set = (jointCubes[f.group] ??= []);
  for (const v of f.v) if (!set.includes(v)) set.push(v);
}

// 服は体そのものではなく補助ジオメトリ「helper-tights」（全身タイツ状のメッシュ）に束縛されている。
// 実行時に服の押し出し方向（法線）と「服に覆われた肌」を求めるため、その面と最寄りの体頂点を出力する
const tightsFaces = baseObj.faces.filter((f) => f.group === 'helper-tights');
const tightsTris = [];
for (const f of tightsFaces) for (let k = 1; k + 1 < f.v.length; k++) tightsTris.push(f.v[0], f.v[k], f.v[k + 1]);
const helperToBody = new Uint16Array(nBase).fill(65535);
for (const hv of new Set(tightsTris)) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < nBody; i++) {
    const dx = basePos[i * 3] - basePos[hv * 3], dy = basePos[i * 3 + 1] - basePos[hv * 3 + 1], dz = basePos[i * 3 + 2] - basePos[hv * 3 + 2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  helperToBody[hv] = best;
}

{
  const pack = new BinPack();
  pack.add('helperTris', new Uint32Array(tightsTris));
  pack.add('helperToBody', helperToBody);
  pack.add('positions', basePos);
  pack.add('rv2v', new Uint32Array(bodyMesh.rv2v));
  pack.add('uv', new Float32Array(bodyMesh.uv));
  pack.add('index', new Uint32Array(bodyMesh.index));
  writePack('base', pack, { vertexCount: nBase, bodyVertexCount: nBody, jointCubes });
}
console.log(`  verts=${nBase} bodyVerts=${nBody} renderVerts=${bodyMesh.rv2v.length} tris=${bodyMesh.index.length / 3}`);

// ---------------------------------------------------------------- rig
console.log('rig');
const rigSrc = JSON.parse(readFileSync(path.join(MPFB, 'rigs/standard/rig.default.json'), 'utf8'));
const weightSrc = JSON.parse(readFileSync(path.join(MPFB, 'rigs/standard/weights.default.json'), 'utf8')).weights;
const boneOrder = [];
{
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    const parent = rigSrc[name].parent;
    if (parent) visit(parent);
    seen.add(name);
    boneOrder.push(name);
  };
  Object.keys(rigSrc).sort().forEach(visit);
}
const boneIndex = Object.fromEntries(boneOrder.map((n, i) => [n, i]));
const convEnd = (e) => {
  if (e.strategy === 'CUBE') return { cube: e.cube_name };
  if (e.strategy === 'VERTEX') return { verts: [e.vertex_index] };
  if (e.strategy === 'MEAN') return { verts: e.vertex_indices };
  throw new Error('unknown strategy ' + e.strategy);
};
const bones = boneOrder.map((name) => ({
  name,
  parent: rigSrc[name].parent ? boneIndex[rigSrc[name].parent] : -1,
  head: convEnd(rigSrc[name].head),
  tail: convEnd(rigSrc[name].tail),
}));
/** @type {[number, number][][]} */
const perVert = Array.from({ length: nBase }, () => []);
for (const [bone, list] of Object.entries(weightSrc)) {
  const bi = boneIndex[bone];
  if (bi === undefined) continue;
  for (const [vi, w] of list) perVert[vi].push([bi, w]);
}
const skinIndex = new Uint8Array(nBase * 4);
const skinWeight = new Float32Array(nBase * 4);
let unweighted = 0;
perVert.forEach((list, vi) => {
  list.sort((a, b) => b[1] - a[1]);
  const top = list.slice(0, 4);
  const sum = top.reduce((s, x) => s + x[1], 0);
  if (sum <= 0) {
    unweighted++;
    skinIndex[vi * 4] = boneIndex.root;
    skinWeight[vi * 4] = 1;
    return;
  }
  top.forEach(([bi, w], k) => {
    skinIndex[vi * 4 + k] = bi;
    skinWeight[vi * 4 + k] = w / sum;
  });
});
{
  const pack = new BinPack();
  pack.add('skinIndex', skinIndex);
  pack.add('skinWeight', skinWeight);
  writePack('rig', pack, { bones });
}
console.log(`  bones=${bones.length} unweightedVerts=${unweighted}`);

// ---------------------------------------------------------------- targets
console.log('targets');
// 成人のみを対象とするため baby/child のマクロターゲットは含めない
const TARGET_DIRS = ['macrodetails', 'macrodetails/height', 'macrodetails/proportions', 'breast', 'torso', 'hip', 'legs',
  'arms', 'head', 'eyes', 'nose', 'neck', 'stomach', 'buttocks', 'cheek', 'chin', 'mouth', 'ears', 'forehead', 'eyebrows', 'pelvis'];
{
  /** @type {Record<string,[number,number]>} */
  const index = {};
  const idxChunks = [];
  const deltaChunks = [];
  let total = 0;
  let clipped = 0;
  for (const dir of TARGET_DIRS) {
    for (const file of readdirSync(path.join(MPFB, 'targets', dir)).sort()) {
      if (!file.endsWith('.target.gz')) continue;
      if (/-(baby|child)[-.]/.test(file)) continue;
      const name = `${dir.replace('macrodetails/', '')}/${file.replace('.target.gz', '')}`.replace(/^macrodetails\//, 'macro/');
      const t = parseTarget(gunzipSync(readFileSync(path.join(MPFB, 'targets', dir, file))).toString('utf8'));
      const n = t.index.length;
      const d = new Int16Array(n * 3);
      for (let i = 0; i < n * 3; i++) {
        const q = Math.round((t.delta[i] * UNIT) / TARGET_QUANT);
        if (q > 32767 || q < -32768) clipped++;
        d[i] = Math.max(-32768, Math.min(32767, q));
      }
      index[name] = [total, n];
      idxChunks.push(Uint16Array.from(t.index));
      deltaChunks.push(d);
      total += n;
    }
  }
  const allIdx = new Uint16Array(total);
  const allDelta = new Int16Array(total * 3);
  let o = 0;
  idxChunks.forEach((c, k) => {
    allIdx.set(c, o);
    allDelta.set(deltaChunks[k], o * 3);
    o += c.length;
  });
  const pack = new BinPack();
  pack.add('index', allIdx);
  pack.add('delta', allDelta);
  writePack('targets', pack, { quant: TARGET_QUANT, targets: index });
  console.log(`  targets=${Object.keys(index).length} entries=${total} clipped=${clipped}`);
}

// ---------------------------------------------------------------- proxies
console.log('proxies');
/** ベース頂点位置に対する mhclo フィット（単位 m）。実行時の src/human/proxy.ts と同じ式。 */
function fitProxy(clo) {
  const sc = ['x', 'y', 'z'].map((ax, k) => {
    const s = clo.scale[ax];
    if (!s) return 1;
    return Math.abs(basePos[s.v1 * 3 + k] - basePos[s.v2 * 3 + k]) / (s.den * UNIT);
  });
  const out = new Float32Array(clo.verts.length * 3);
  clo.verts.forEach((b, i) => {
    for (let k = 0; k < 3; k++) {
      out[i * 3 + k] =
        b.w[0] * basePos[b.v[0] * 3 + k] + b.w[1] * basePos[b.v[1] * 3 + k] + b.w[2] * basePos[b.v[2] * 3 + k] +
        b.off[k] * UNIT * sc[k];
    }
  });
  return out;
}

function copyTex(srcDir, file, id) {
  if (!file) return null;
  const src = path.join(srcDir, file);
  if (!existsSync(src)) {
    console.warn(`  missing texture: ${src}`);
    return null;
  }
  const name = `${id}__${path.basename(file)}`;
  copyFileSync(src, path.join(OUT, 'tex', name));
  return `tex/${name}`;
}

function copyThumb(src, id) {
  if (!existsSync(src)) return null;
  copyFileSync(src, path.join(OUT, 'thumbs', id + '.png'));
  return `thumbs/${id}.png`;
}

/**
 * @param {string} dir mhclo のあるディレクトリ
 * @param {string} id 出力ID
 * @param {{split?: boolean}} [opt]
 * @returns {{id:string, slot?:string}[]} 出力した proxy
 */
function convertProxy(dir, id, opt = {}) {
  const mhcloFile = readdirSync(dir).find((f) => f.endsWith('.mhclo'));
  const clo = parseMhclo(readFileSync(path.join(dir, mhcloFile), 'utf8'));
  const obj = parseObj(readFileSync(path.join(dir, clo.objFile), 'utf8'));
  if (obj.v.length !== clo.verts.length) throw new Error(`${id}: vertex count mismatch ${obj.v.length} vs ${clo.verts.length}`);
  const mat = clo.material ? parseMhmat(readFileSync(path.join(dir, clo.material), 'utf8')) : {};
  const matDir = clo.material ? path.dirname(path.join(dir, clo.material)) : dir;
  const material = {
    diffuse: copyTex(matDir, mat.diffuseTexture, id),
    normal: copyTex(matDir, mat.normalmapTexture, id),
    ao: copyTex(matDir, mat.aomapTexture, id),
    transparent: mat.transparent === 'True',
    doubleSided: mat.backfaceCull === 'False',
  };
  const fitted = fitProxy(clo);

  // 上下一体のスーツは連結成分ごとに上半身/下半身へ振り分ける
  /** @type {Map<string, number[]>} slot -> proxy頂点 */
  const pieces = new Map();
  if (opt.split) {
    const comp = connectedComponents(obj.v.length, obj.faces);
    const bbox = new Map();
    for (let i = 0; i < comp.length; i++) {
      const y = fitted[i * 3 + 1];
      const b = bbox.get(comp[i]) ?? [Infinity, -Infinity];
      b[0] = Math.min(b[0], y);
      b[1] = Math.max(b[1], y);
      bbox.set(comp[i], b);
    }
    // ベースメッシュの股下〜腰はおよそ y=0〜0.1m。成分の中心がそれより上なら上半身側
    for (let i = 0; i < comp.length; i++) {
      const b = bbox.get(comp[i]);
      const slot = (b[0] + b[1]) / 2 > 0.15 ? 'top' : 'bottom';
      if (!pieces.has(slot)) pieces.set(slot, []);
      pieces.get(slot).push(i);
    }
  } else {
    pieces.set('', obj.v.map((_, i) => i));
  }

  // 体の非表示頂点を、最も近い服頂点の属するピースへ割り当てる
  /** @type {Map<string, number[]>} */
  const deleteBySlot = new Map([...pieces.keys()].map((k) => [k, []]));
  if (pieces.size === 1) {
    deleteBySlot.set([...pieces.keys()][0], clo.deleteVerts);
  } else {
    const slotOf = new Array(obj.v.length);
    for (const [slot, list] of pieces) for (const i of list) slotOf[i] = slot;
    for (const dv of clo.deleteVerts) {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < obj.v.length; i++) {
        const dx = fitted[i * 3] - basePos[dv * 3];
        const dy = fitted[i * 3 + 1] - basePos[dv * 3 + 1];
        const dz = fitted[i * 3 + 2] - basePos[dv * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      deleteBySlot.get(slotOf[best]).push(dv);
    }
  }

  const outputs = [];
  for (const [slot, list] of pieces) {
    const pid = slot ? `${id}_${slot}` : id;
    const remap = new Map(list.map((v, k) => [v, k]));
    const faces = obj.faces
      .filter((f) => f.v.every((v) => remap.has(v)))
      .map((f) => ({ v: f.v.map((v) => remap.get(v)), vt: f.vt }));
    const mesh = buildRenderMesh(faces, obj.vt);
    const n = list.length;
    const bindV = new Uint16Array(n * 3);
    const bindW = new Float32Array(n * 3);
    const bindOff = new Float32Array(n * 3);
    list.forEach((src, k) => {
      const b = clo.verts[src];
      bindV.set(b.v, k * 3);
      bindW.set(b.w, k * 3);
      bindOff.set(b.off.map((x) => x * UNIT), k * 3);
    });
    const pack = new BinPack();
    pack.add('bindV', bindV);
    pack.add('bindW', bindW);
    pack.add('bindOff', bindOff);
    pack.add('rv2v', new Uint32Array(mesh.rv2v));
    pack.add('uv', new Float32Array(mesh.uv));
    pack.add('index', new Uint32Array(mesh.index));
    pack.add('deleteVerts', new Uint16Array(deleteBySlot.get(slot)));
    const scale = Object.fromEntries(
      ['x', 'y', 'z'].map((ax) => [ax, clo.scale[ax] ? { v1: clo.scale[ax].v1, v2: clo.scale[ax].v2, den: clo.scale[ax].den * UNIT } : null]),
    );
    writePack(`proxies/${pid}`, pack, { id: pid, vertexCount: n, scale, material });
    outputs.push({ id: pid, slot });
  }
  return outputs;
}

const catalog = {
  hair: [], eyebrows: [], eyelashes: [], tops: [], bottoms: [], shoes: [], hats: [], skins: [], eyeTextures: [],
  eyes: 'eyes', teeth: 'teeth', tongue: 'tongue', hdri: [],
};

const HAIR_LABELS = {
  afro01: 'アフロ', bob01: 'ボブ A', bob02: 'ボブ B', braid01: '三つ編み', long01: 'ロング', ponytail01: 'ポニーテール',
  short01: 'ショート A', short02: 'ショート B', short03: 'ショート C', short04: 'ショート D',
};
for (const id of readdirSync(path.join(SYS, 'hair'))) {
  const dir = path.join(SYS, 'hair', id);
  convertProxy(dir, `hair_${id}`);
  catalog.hair.push({ id: `hair_${id}`, label: HAIR_LABELS[id] ?? id, thumb: copyThumb(path.join(dir, id + '.thumb'), `hair_${id}`) });
}
for (const id of readdirSync(path.join(SYS, 'eyebrows'))) {
  convertProxy(path.join(SYS, 'eyebrows', id), id);
  catalog.eyebrows.push({ id, label: '眉 ' + id.replace('eyebrow0', '').replace(/^0/, '') });
}
for (const id of readdirSync(path.join(SYS, 'eyelashes'))) {
  convertProxy(path.join(SYS, 'eyelashes', id), id);
  catalog.eyelashes.push({ id, label: 'まつ毛 ' + id.replace('eyelashes0', '') });
}
convertProxy(path.join(SYS, 'eyes/high-poly'), 'eyes');
convertProxy(path.join(SYS, 'teeth/teeth_base'), 'teeth');
convertProxy(path.join(SYS, 'tongue/tongue01'), 'tongue');
for (const f of readdirSync(path.join(SYS, 'eyes/materials'))) {
  if (!f.endsWith('_eye.png')) continue;
  const id = f.replace('_eye.png', '');
  copyFileSync(path.join(SYS, 'eyes/materials', f), path.join(OUT, 'tex', f));
  catalog.eyeTextures.push({ id, texture: `tex/${f}` });
}

const SUIT_LABELS = {
  female_casualsuit01: 'カジュアル A（レディース）', female_casualsuit02: 'カジュアル B（レディース）',
  female_elegantsuit01: 'エレガント（レディース）', female_sportsuit01: 'スポーツ（レディース）',
  male_casualsuit01: 'カジュアル A（メンズ）', male_casualsuit02: 'カジュアル B（メンズ）', male_casualsuit03: 'カジュアル C（メンズ）',
  male_casualsuit04: 'カジュアル D（メンズ）', male_casualsuit05: 'カジュアル E（メンズ）', male_casualsuit06: 'カジュアル F（メンズ）',
  male_elegantsuit01: 'スーツ（メンズ）', male_worksuit01: '作業着（メンズ）',
};
for (const id of readdirSync(path.join(SYS, 'clothes'))) {
  const dir = path.join(SYS, 'clothes', id);
  const thumb = copyThumb(path.join(dir, id + '.thumb'), id);
  if (id.startsWith('shoes')) {
    convertProxy(dir, id);
    catalog.shoes.push({ id, label: 'シューズ ' + id.replace('shoes0', ''), thumb });
  } else if (id.startsWith('fedora')) {
    convertProxy(dir, id);
    catalog.hats.push({ id, label: id === 'fedora01' ? '中折れ帽' : '中折れ帽（斜め）', thumb });
  } else {
    const outs = convertProxy(dir, id, { split: true });
    const label = SUIT_LABELS[id] ?? id;
    const gender = id.startsWith('female') ? 'female' : 'male';
    if (outs.length === 1) {
      // 分割できない一体型は「全身」としてトップス側に載せる
      catalog.tops.push({ id: outs[0].id, label: label + ' 上下一体', thumb, gender, full: true });
    } else {
      for (const o of outs) {
        (o.slot === 'top' ? catalog.tops : catalog.bottoms).push({ id: o.id, label, thumb, gender });
      }
    }
    console.log(`  ${id}: ${outs.map((o) => o.slot).join('+')}`);
  }
}

// ---------------------------------------------------------------- skins
console.log('skins');
for (const id of readdirSync(path.join(SYS, 'skins'))) {
  const m = /^(young|middleage|old)_(african|asian|caucasian)_(female|male)(2?)$/.exec(id);
  if (!m) continue;
  const dir = path.join(SYS, 'skins', id);
  const mat = parseMhmat(readFileSync(path.join(dir, id + '.mhmat'), 'utf8'));
  catalog.skins.push({ id, age: m[1], race: m[2], gender: m[3], variant: m[4] ? 2 : 1, texture: copyTex(dir, mat.diffuseTexture, id) });
}

// ---------------------------------------------------------------- hdri
for (const f of readdirSync(path.join(root, 'assets-src/hdri'))) {
  if (!f.endsWith('.hdr')) continue;
  copyFileSync(path.join(root, 'assets-src/hdri', f), path.join(OUT, 'hdri', f));
  catalog.hdri.push({ id: f.replace('_2k.hdr', ''), file: `hdri/${f}` });
}

writeJson('catalog.json', catalog);
console.log('done:', Object.entries(catalog).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}=${v.length}`).join(' '));
