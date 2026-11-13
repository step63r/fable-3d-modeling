import * as THREE from 'three';
import { loadCatalog, loadPack, type BaseMeta, type Catalog, type Pack, type ProxyMeta, type RigMeta, type SkinEntry, type TargetsMeta } from './assets';
import { TargetSet, computeVertexNormals } from './morph';
import { ageToMacro, macroWeights } from './macros';
import { modifierWeights } from './modifiers';
import { Rig } from './skeleton';
import { Proxy, expand } from './proxy';
import { applyPose } from './pose';
import type { BodyState, CharacterState, ClothesState, GarmentState, LookState } from '../state';
import { FEDORA_HAIR_CLIP, SHELL_DEFS, ShellFactory } from './procedural';
import { GLASSES, buildGlasses } from './glasses';
import {
  averageColor, createBrowMaterial, createClothMaterial, createCorneaMaterial, createEyeMaterial, createHairMaterial, createSkinMaterial,
  alphaSampler, eyeTexture, loadImage, loadTexture, tintedTexture,
} from '../render/materials';

type Slot = 'eyes' | 'eyebrows' | 'eyelashes' | 'hair' | 'top' | 'bottom' | 'shoes' | 'hat';
const GARMENT_SLOTS = ['top', 'bottom', 'shoes', 'hat'] as const;
/** 服と肌の間に最低限確保するすき間 [m] */
const MIN_CLOTH_GAP = 0.0025;
/** 服の下の肌を内側へ沈める量 [m] */
const SKIN_SHRINK = 0.006;

interface SlotEntry {
  proxy: Proxy;
  material: THREE.Material;
  /** 染色などで生成したテクスチャ（差し替え時に破棄する） */
  ownedTexture?: THREE.Texture;
  appearanceKey: string;
  /** overlay メッシュ用のマテリアル（破棄対象） */
  extraMaterials?: THREE.Material[];
}

export class Human {
  readonly group = new THREE.Group();
  readonly rig: Rig;
  readonly catalog: Catalog;
  /** モーフ・スケール適用後のベース頂点（レスト姿勢, m） */
  readonly verts: Float32Array;
  /** レスト姿勢での身長 [cm] */
  heightCm = 0;

  private readonly basePos: Float32Array;
  private readonly nBody: number;
  private readonly targets: TargetSet;
  private readonly skinIndex: Uint8Array;
  private readonly skinWeight: Float32Array;
  private readonly bodyRv2v: Uint32Array;
  private readonly bodyIndex: Uint32Array;
  private readonly bodyNormals: Float32Array;
  /** 法線計算用の三角形（体＋服の束縛先である補助タイツ） */
  private readonly normalTris: Uint32Array;
  /** 補助タイツ頂点 → 最寄りの体頂点（該当なしは 65535） */
  private readonly helperToBody: Uint16Array;
  private readonly bodyGeometry = new THREE.BufferGeometry();
  readonly bodyMesh: THREE.SkinnedMesh;
  readonly skinMaterial = createSkinMaterial();
  private readonly scratch: Float32Array;
  private readonly shrink: Float32Array;
  private readonly posed: Float32Array;

  private readonly slots = new Map<Slot, SlotEntry>();
  private readonly slotToken = new Map<Slot, number>();
  private readonly packCache = new Map<string, Promise<Pack<ProxyMeta>>>();
  private readonly shells: ShellFactory;
  private glasses?: THREE.Group;
  private skinKey = '';
  private skinAvg = new THREE.Color(0.8, 0.6, 0.5);
  private last = { body: '', look: '', clothes: '', pose: '' };
  private current!: CharacterState;
  /** ポーズ適用後に呼ばれる追加処理（眼鏡などの手続き型アクセサリ用） */
  readonly onRebuilt: (() => void)[] = [];

  private constructor(base: Pack<BaseMeta>, rig: Pack<RigMeta>, targets: Pack<TargetsMeta>, catalog: Catalog) {
    this.catalog = catalog;
    this.basePos = base.arrays.positions as Float32Array;
    this.nBody = base.meta.bodyVertexCount;
    this.verts = new Float32Array(this.basePos.length);
    this.scratch = new Float32Array(this.basePos.length);
    this.shrink = new Float32Array(this.basePos.length / 3);
    this.posed = new Float32Array(this.basePos.length);
    this.targets = new TargetSet(targets.arrays.index as Uint16Array, targets.arrays.delta as Int16Array, targets.meta.quant, targets.meta.targets);
    this.skinIndex = rig.arrays.skinIndex as Uint8Array;
    this.skinWeight = rig.arrays.skinWeight as Float32Array;
    this.rig = new Rig(rig.meta.bones, base.meta.jointCubes);
    this.group.add(this.rig.root);

    this.bodyRv2v = base.arrays.rv2v as Uint32Array;
    this.bodyIndex = base.arrays.index as Uint32Array;
    this.bodyNormals = new Float32Array(this.basePos.length);
    this.helperToBody = base.arrays.helperToBody as Uint16Array;
    const helperTris = base.arrays.helperTris as Uint32Array;
    const bodyTris = this.bodyTris();
    this.normalTris = new Uint32Array(bodyTris.length + helperTris.length);
    this.normalTris.set(bodyTris);
    this.normalTris.set(helperTris, bodyTris.length);
    const rn = this.bodyRv2v.length;
    const si = new Uint16Array(rn * 4);
    const sw = new Float32Array(rn * 4);
    for (let r = 0; r < rn; r++) {
      const v = this.bodyRv2v[r] * 4;
      for (let k = 0; k < 4; k++) {
        si[r * 4 + k] = this.skinIndex[v + k];
        sw[r * 4 + k] = this.skinWeight[v + k];
      }
    }
    const g = this.bodyGeometry;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rn * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(rn * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(base.arrays.uv as Float32Array, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.bodyIndex), 1));
    this.bodyMesh = new THREE.SkinnedMesh(g, this.skinMaterial);
    this.bodyMesh.name = 'body';
    this.bodyMesh.frustumCulled = false;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.group.add(this.bodyMesh);
    this.bodyMesh.bind(this.rig.skeleton, new THREE.Matrix4());

    // 手続き生成の衣類はベース形状（モーフ前）を基準に切り出す
    this.rig.updateRest(this.basePos);
    const vertUv = new Float32Array((this.basePos.length / 3) * 2);
    const uv = base.arrays.uv as Float32Array;
    for (let r = rn - 1; r >= 0; r--) {
      vertUv[this.bodyRv2v[r] * 2] = uv[r * 2];
      vertUv[this.bodyRv2v[r] * 2 + 1] = uv[r * 2 + 1];
    }
    this.shells = new ShellFactory({
      basePos: this.basePos, nBody: this.nBody, tris: this.bodyTris(), vertUv, bones: rig.meta.bones,
      skinIndex: this.skinIndex, skinWeight: this.skinWeight,
      joint: (name) => this.rig.headOf(name).toArray() as [number, number, number],
    });
    const visible = SHELL_DEFS.filter((d) => !['proc_bra', 'proc_briefs', 'proc_trunks'].includes(d.id));
    catalog.tops.push(...visible.filter((d) => d.slot === 'top').map(({ id, label }) => ({ id, label })));
    catalog.bottoms.push(...visible.filter((d) => d.slot === 'bottom').map(({ id, label }) => ({ id, label })));
    catalog.hats.push(...visible.filter((d) => d.slot === 'hat').map(({ id, label }) => ({ id, label })));
    catalog.glasses = GLASSES.map(({ id, label }) => ({ id, label }));
  }

  static async load(onProgress: (text: string) => void): Promise<Human> {
    onProgress('ベースメッシュを読み込み中…');
    const [catalog, base, rig] = await Promise.all([
      loadCatalog(), loadPack<BaseMeta>('base'), loadPack<RigMeta>('rig'),
    ]);
    onProgress('モーフターゲットを読み込み中…');
    const targets = await loadPack<TargetsMeta>('targets');
    return new Human(base, rig, targets, catalog);
  }

  /** 状態を反映する。変化した部分だけを更新する。 */
  async update(state: CharacterState): Promise<void> {
    this.current = state;
    const keys = {
      body: JSON.stringify(state.body),
      look: JSON.stringify(state.look),
      // 「なし」のときの下着は性別で変わる
      clothes: JSON.stringify(state.clothes) + (state.body.gender < 0.5),
      pose: JSON.stringify(state.pose),
    };
    const bodyChanged = keys.body !== this.last.body;
    const lookChanged = keys.look !== this.last.look || bodyChanged; // 肌テクスチャは性別・年齢に連動
    const clothesChanged = keys.clothes !== this.last.clothes;
    const poseChanged = keys.pose !== this.last.pose;
    this.last = keys;

    if (bodyChanged) this.rebuildBody(state.body);
    const jobs: Promise<void>[] = [];
    if (lookChanged) jobs.push(this.applyLook(state.look, state.body));
    if (clothesChanged) jobs.push(this.applyClothes(state.clothes, state.body));
    if (bodyChanged || clothesChanged) this.updateGlasses(state.clothes.glasses);
    if (bodyChanged || poseChanged) this.repose();
    await Promise.all(jobs);
    if (lookChanged || clothesChanged) this.updateHairClip();
  }

  // ------------------------------------------------------------------ body

  private morph(body: BodyState, heightMacro: number, out: Float32Array): void {
    const weights = macroWeights({
      gender: body.gender, age: ageToMacro(body.age), muscle: body.muscle, weight: body.weight, height: heightMacro,
      proportions: body.proportions, cup: body.cup, firmness: body.firmness,
      african: body.african, asian: body.asian, caucasian: body.caucasian,
    }, this.targets.has);
    modifierWeights(body.mods, weights);
    // 乳頭の突起は服や下着の上に浮き出てしまうので、常に平らにしておく
    weights.set('breast/nipple-point-decr', 1);
    weights.set('breast/nipple-size-decr', 1);
    this.targets.apply(this.basePos, weights, out);
  }

  private bodyExtentY(v: Float32Array): [min: number, max: number] {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < this.nBody; i++) {
      const y = v[i * 3 + 1];
      if (y < mn) mn = y;
      if (y > mx) mx = y;
    }
    return [mn, mx];
  }

  private rebuildBody(body: BodyState): void {
    // 身長[cm]の指定をマクロの身長ターゲット(0〜1)に逆算する。
    // ターゲット合成は線形なので、身長は 0 / 0.5 / 1 の3点を結ぶ折れ線でほぼ正確に表せる。
    const target = body.height / 100;
    const h = [0, 0.5, 1].map((m) => {
      this.morph(body, m, this.scratch);
      const [mn, mx] = this.bodyExtentY(this.scratch);
      return mx - mn;
    });
    let macro: number;
    if (target <= h[1]) macro = 0.5 * Math.max(0, (target - h[0]) / (h[1] - h[0]));
    else macro = 0.5 + 0.5 * Math.min(1, (target - h[1]) / (h[2] - h[1]));
    this.morph(body, macro, this.verts);
    const [mn, mx] = this.bodyExtentY(this.verts);
    // マクロの範囲で届かない分は全体の一様スケールで補う
    const scale = target / (mx - mn);
    const v = this.verts;
    for (let i = 0; i < v.length; i += 3) {
      v[i] *= scale;
      v[i + 1] = (v[i + 1] - mn) * scale;
      v[i + 2] *= scale;
    }
    this.heightCm = target * 100;

    this.rig.updateRest(v);
    computeVertexNormals(v, this.normalTris, this.bodyNormals);
    this.updateBodyGeometry();
    for (const entry of this.slots.values()) entry.proxy.fit(v, this.bodyNormals);
  }

  /** 体の描画用頂点を更新する。服の下の肌は少し内側へ沈め、ポーズ時に服を突き抜けないようにする。 */
  private updateBodyGeometry(): void {
    const v = this.verts, n = this.bodyNormals, shrink = this.shrink;
    const pos = this.bodyGeometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = this.bodyGeometry.getAttribute('normal') as THREE.BufferAttribute;
    const out = pos.array as Float32Array;
    for (let r = 0; r < this.bodyRv2v.length; r++) {
      const i = this.bodyRv2v[r];
      const s = shrink[i];
      out[r * 3] = v[i * 3] - n[i * 3] * s;
      out[r * 3 + 1] = v[i * 3 + 1] - n[i * 3 + 1] * s;
      out[r * 3 + 2] = v[i * 3 + 2] - n[i * 3 + 2] * s;
    }
    expand(n, this.bodyRv2v, nor.array as Float32Array);
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }

  private _bodyTris?: Uint32Array;
  private bodyTris(): Uint32Array {
    if (!this._bodyTris) {
      this._bodyTris = new Uint32Array(this.bodyIndex.length);
      for (let i = 0; i < this.bodyIndex.length; i++) this._bodyTris[i] = this.bodyRv2v[this.bodyIndex[i]];
    }
    return this._bodyTris;
  }

  /** 服に覆われた体のポリゴンを描画対象から外す（ポーズ時の突き抜け防止）。 */
  private updateBodyMask(): void {
    const hidden = new Uint8Array(this.basePos.length / 3);
    for (const slot of GARMENT_SLOTS) {
      const entry = this.slots.get(slot);
      if (entry) for (const v of entry.proxy.deleteVerts) hidden[v] = 1;
    }
    const tris = this.bodyTris();
    const out: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      if (hidden[tris[t]] || hidden[tris[t + 1]] || hidden[tris[t + 2]]) continue;
      out.push(this.bodyIndex[t], this.bodyIndex[t + 1], this.bodyIndex[t + 2]);
    }
    this.bodyGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(out), 1));

    // 靴に付属する靴下部分は、裾の長いボトムスの内側に隠れる範囲を描画しない
    const bottom = this.slots.get('bottom');
    const shoes = this.slots.get('shoes');
    if (shoes) {
      let covered: Uint8Array | null = null;
      if (bottom && bottom.proxy.deleteVerts.length) {
        covered = new Uint8Array(hidden.length);
        for (const v of bottom.proxy.deleteVerts) covered[v] = 1;
      }
      shoes.proxy.hideByBase(covered);
    }

    // 服が束縛されている体の頂点＝服に覆われた肌。1リング広げてから沈め量を設定する
    const covered = new Uint8Array(hidden.length);
    for (const slot of ['top', 'bottom', 'shoes'] as const) {
      const entry = this.slots.get(slot);
      if (!entry) continue;
      for (const bv of entry.proxy.bindV) {
        const body = bv < this.nBody ? bv : this.helperToBody[bv];
        if (body !== 65535) covered[body] = 1;
      }
    }
    const grown = new Uint8Array(covered);
    for (let t = 0; t < tris.length; t += 3) {
      if (covered[tris[t]] || covered[tris[t + 1]] || covered[tris[t + 2]]) grown[tris[t]] = grown[tris[t + 1]] = grown[tris[t + 2]] = 1;
    }
    for (let i = 0; i < grown.length; i++) this.shrink[i] = grown[i] ? SKIN_SHRINK : 0;
    this.updateBodyGeometry();
  }

  // ------------------------------------------------------------------ pose

  private repose(): void {
    applyPose(this.rig, this.current.pose);
    this.ground();
    for (const fn of this.onRebuilt) fn();
  }

  /** 現在のポーズで最も低い点が床(y=0)に接するように全体を上下させる。 */
  private ground(): void {
    this.group.position.y = 0;
    this.group.updateMatrixWorld(true);
    this.rig.skin(this.verts, this.skinIndex, this.skinWeight, this.posed, this.nBody);
    let mn = Infinity;
    for (let i = 0; i < this.nBody; i++) mn = Math.min(mn, this.posed[i * 3 + 1]);
    const shoes = this.slots.get('shoes')?.proxy;
    if (shoes) {
      const tmp = new Float32Array(shoes.positions.length);
      this.rig.skin(shoes.positions, shoes.skinIndex, shoes.skinWeight, tmp);
      for (let i = 1; i < tmp.length; i += 3) mn = Math.min(mn, tmp[i]);
    }
    this.group.position.y = -mn;
    this.group.updateMatrixWorld(true);
  }

  /** 現在のポーズでの体のバウンディングボックス（ワールド座標）。 */
  getBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    this.rig.skin(this.verts, this.skinIndex, this.skinWeight, this.posed, this.nBody);
    for (let i = 0; i < this.nBody; i++) box.expandByPoint(p.fromArray(this.posed, i * 3));
    box.translate(this.group.position);
    return box;
  }

  headCenter(): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    const head = this.rig.bone('head');
    const len = this.rig.tailOf('head').distanceTo(this.rig.headOf('head'));
    return new THREE.Vector3(0, len * 0.55, len * 0.25).applyMatrix4(head.matrixWorld);
  }

  // ------------------------------------------------------------------ look

  private pickSkin(look: LookState, body: BodyState): SkinEntry {
    const skins = this.catalog.skins;
    const explicit = skins.find((s) => s.id === look.skin);
    if (explicit) return explicit;
    const gender = body.gender > 0.5 ? 'male' : 'female';
    const age = body.age < 42 ? 'young' : body.age < 62 ? 'middleage' : 'old';
    const race = body.african >= body.asian && body.african >= body.caucasian ? 'african' : body.asian >= body.caucasian ? 'asian' : 'caucasian';
    return skins.find((s) => s.gender === gender && s.age === age && s.race === race && s.variant === 1)
      ?? skins.find((s) => s.gender === gender && s.race === race)
      ?? skins[0];
  }

  private async applyLook(look: LookState, body: BodyState): Promise<void> {
    const jobs: Promise<void>[] = [];
    const skin = this.pickSkin(look, body);
    if (skin.id !== this.skinKey) {
      this.skinKey = skin.id;
      jobs.push((async () => {
        const [tex, img] = await Promise.all([loadTexture(skin.texture), loadImage(skin.texture)]);
        if (this.skinKey !== skin.id) return;
        this.skinAvg = averageColor(img);
        this.skinMaterial.map = tex;
        this.skinMaterial.bumpMap = tex;
        this.skinMaterial.needsUpdate = true;
        this.applySkinTone(this.current.look.skinTone);
      })());
    }
    this.applySkinTone(look.skinTone);

    jobs.push(this.setSlot('eyes', 'eyes', `eye:${look.eyeColor}`, createEyeMaterial, async (entry) => {
      const img = await loadImage('tex/brown_eye.png');
      this.replaceMap(entry, eyeTexture(img, look.eyeColor));
      if (!entry.extraMaterials) {
        // 眼球メッシュの外側の層（角膜）はテクスチャの透明領域に割り当てられている。
        // そこだけ映り込み専用マテリアルにして、下の虹彩が見えるようにする
        const alpha = alphaSampler(img);
        const cornea = createCorneaMaterial();
        entry.extraMaterials = [cornea];
        entry.proxy.partition((u, v) => alpha(u, v) < 0.5, cornea);
      }
    }));
    jobs.push(this.setSlot('hair', look.hair, `hair:${look.hairColor}`, createHairMaterial, async (entry) => {
      const diffuse = entry.proxy.meta.material.diffuse;
      if (diffuse) this.replaceMap(entry, tintedTexture(await loadImage(diffuse), look.hairColor, { contrast: 0.7, maxGain: 1.35 }));
    }));
    const browColor = '#' + new THREE.Color(look.hairColor).multiplyScalar(0.55).getHexString();
    jobs.push(this.setSlot('eyebrows', look.eyebrows, `brow:${browColor}`, createBrowMaterial, async (entry) => {
      const diffuse = entry.proxy.meta.material.diffuse;
      if (diffuse) this.replaceMap(entry, tintedTexture(await loadImage(diffuse), browColor, { contrast: 0, alphaGain: 1.5 }));
    }));
    jobs.push(this.setSlot('eyelashes', look.eyelashes, 'lash', createBrowMaterial, async (entry) => {
      const diffuse = entry.proxy.meta.material.diffuse;
      if (diffuse) this.replaceMap(entry, tintedTexture(await loadImage(diffuse), '#0c0807', { contrast: 0 }));
    }));
    await Promise.all(jobs);
  }

  /** テクスチャの平均色が指定の肌色になるよう、乗算色で色味を合わせる。 */
  private applySkinTone(tone: string): void {
    const t = new THREE.Color(tone);
    const a = this.skinAvg;
    const clamp = (x: number) => Math.min(2.5, Math.max(0.02, x));
    // 指定色は「照明下で見える色」として扱う。そのままアルベドにすると明るい肌が白飛びするので少し抑える
    const k = 0.78;
    this.skinMaterial.color.setRGB(clamp((t.r * k) / a.r), clamp((t.g * k) / a.g), clamp((t.b * k) / a.b));
  }

  private replaceMap(entry: SlotEntry, tex: THREE.Texture): void {
    entry.ownedTexture?.dispose();
    entry.ownedTexture = tex;
    const m = entry.material as THREE.MeshStandardMaterial;
    m.map = tex;
    m.needsUpdate = true;
  }

  // ------------------------------------------------------------------ slots

  private loadProxyPack(id: string): Promise<Pack<ProxyMeta>> {
    let p = this.packCache.get(id);
    if (!p) {
      const shell = SHELL_DEFS.find((d) => d.id === id);
      p = shell ? Promise.resolve(this.shells.build(shell)) : loadPack<ProxyMeta>(`proxies/${id}`);
      this.packCache.set(id, p);
    }
    return p;
  }

  private removeSlot(slot: Slot): void {
    const entry = this.slots.get(slot);
    if (!entry) return;
    this.group.remove(entry.proxy.mesh);
    if (entry.proxy.overlay) this.group.remove(entry.proxy.overlay);
    entry.proxy.dispose();
    entry.ownedTexture?.dispose();
    entry.material.dispose();
    for (const m of entry.extraMaterials ?? []) m.dispose();
    this.slots.delete(slot);
  }

  /**
   * スロットのメッシュ・見た目を指定の状態にする。
   * @param appearanceKey 見た目（色など）を表すキー。変わったときだけ decorate を呼ぶ
   */
  private async setSlot(
    slot: Slot, id: string, appearanceKey: string, makeMaterial: () => THREE.Material,
    decorate: (entry: SlotEntry) => Promise<void>,
  ): Promise<void> {
    const token = (this.slotToken.get(slot) ?? 0) + 1;
    this.slotToken.set(slot, token);
    const stale = () => this.slotToken.get(slot) !== token;
    let entry = this.slots.get(slot);
    if (!id) {
      this.removeSlot(slot);
      return;
    }
    if (!entry || entry.proxy.id !== id) {
      const pack = await this.loadProxyPack(id);
      if (stale()) return;
      const material = makeMaterial();
      const proxy = new Proxy(pack, this.skinIndex, this.skinWeight, material);
      const fresh: SlotEntry = { proxy, material, appearanceKey: '' };
      // 差し替え時に一瞬テクスチャ無しで表示されるのを避けるため、見た目を整えてからシーンに入れる
      await decorate(fresh);
      if (stale()) {
        proxy.dispose();
        fresh.ownedTexture?.dispose();
        material.dispose();
        return;
      }
      fresh.appearanceKey = appearanceKey;
      this.removeSlot(slot);
      if (slot === 'top' || slot === 'bottom') proxy.minGap = MIN_CLOTH_GAP;
      proxy.fit(this.verts, this.bodyNormals);
      proxy.mesh.bind(this.rig.skeleton, new THREE.Matrix4());
      this.group.add(proxy.mesh);
      if (proxy.overlay) {
        proxy.overlay.bind(this.rig.skeleton, new THREE.Matrix4());
        this.group.add(proxy.overlay);
      }
      this.slots.set(slot, fresh);
      return;
    }
    if (entry.appearanceKey !== appearanceKey) {
      await decorate(entry);
      if (!stale()) entry.appearanceKey = appearanceKey;
    }
  }

  // ------------------------------------------------------------------ clothes

  private async applyClothes(clothes: ClothesState, body: BodyState): Promise<void> {
    const apply = (slot: (typeof GARMENT_SLOTS)[number], g: GarmentState) =>
      this.setSlot(slot, g.id, `cloth:${g.color}`, createClothMaterial, async (entry) => {
        const mat = entry.material as THREE.MeshPhysicalMaterial;
        const src0 = entry.proxy.meta;
        const src = src0.material;
        if (src.diffuse) {
          if (g.color) this.replaceMap(entry, tintedTexture(await loadImage(src.diffuse), g.color));
          else {
            entry.ownedTexture?.dispose();
            entry.ownedTexture = undefined;
            mat.map = await loadTexture(src.diffuse);
          }
        } else mat.color.set(g.color || src0.defaultColor || '#888888');
        if (src0.roughness !== undefined) mat.roughness = src0.roughness;
        if (src.normal) mat.normalMap = await loadTexture(src.normal, false);
        if (src.ao) mat.aoMap = await loadTexture(src.ao, false);
        // 裾のほつれ等をアルファで抜いているテクスチャがある
        mat.alphaTest = 0.5;
        mat.alphaToCoverage = true;
        mat.needsUpdate = true;
      });
    // 上下一体型を着ているときはボトムスを外す
    const topFull = this.catalog.tops.find((t) => t.id === clothes.top.id)?.full;
    // 何も着ていない部位には下着を着せる
    const female = body.gender < 0.5;
    const top = clothes.top.id ? clothes.top : { id: female ? 'proc_bra' : '', color: '' };
    const bottom = clothes.bottom.id ? clothes.bottom : { id: female ? 'proc_briefs' : 'proc_trunks', color: '' };
    await Promise.all([
      apply('top', top),
      apply('bottom', topFull ? { id: '', color: '' } : bottom),
      apply('shoes', clothes.shoes),
      apply('hat', clothes.hat),
    ]);
    this.updateBodyMask();
    this.ground();
  }

  /** 帽子をかぶっているとき、帽子の下に隠れるはずの髪を描画から外す。 */
  private updateHairClip(): void {
    const hair = this.slots.get('hair');
    if (!hair) return;
    const hat = this.slots.get('hat');
    const plane = hat ? hat.proxy.meta.hairClip ?? FEDORA_HAIR_CLIP : null;
    hair.proxy.setClip(this.basePos, plane);
  }

  private updateGlasses(g: GarmentState): void {
    const def = GLASSES.find((d) => d.id === g.id);
    if (this.glasses) {
      this.glasses.removeFromParent();
      this.glasses.userData.dispose();
      this.glasses = undefined;
    }
    if (!def) return;
    const v = this.verts;
    // 鼻筋（目の高さ）と耳の付け根上部に当たるベースメッシュ頂点
    const BRIDGE = 134, EAR = 7701;
    const group = buildGlasses(def, {
      eye: this.rig.headOf('eye.L'),
      bridge: new THREE.Vector3().fromArray(v, BRIDGE * 3),
      ear: new THREE.Vector3().fromArray(v, EAR * 3),
    }, g.color);
    // 頭ボーンの子にして剛体として追従させる。ボーンはレスト時ワールド軸揃いなので平行移動だけで合う
    group.position.copy(this.rig.headOf('head')).negate();
    this.rig.bone('head').add(group);
    this.glasses = group;
  }

  /** 表示中の全メッシュ（体＋各スロット）。 */
  meshes(): THREE.SkinnedMesh[] {
    return [this.bodyMesh, ...[...this.slots.values()].map((e) => e.proxy.mesh)];
  }
}
