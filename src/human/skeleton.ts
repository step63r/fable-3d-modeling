import * as THREE from 'three';
import type { BoneDef, BoneEnd } from './assets';

/**
 * スケルトン。関節位置はモーフ後のメッシュ頂点（関節キューブ等）から毎回求め直す。
 *
 * レスト姿勢のボーンはすべてワールド軸に揃えてある（回転なし・平行移動のみ）。
 * こうしておくと各ボーンのローカル回転軸がレスト時のワールド軸と一致し、
 * 「X軸まわり＝前後屈」のようにポーズを解剖学的な軸で直接記述できる。
 */
export class Rig {
  readonly bones: THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  readonly root: THREE.Bone;
  readonly head: Float32Array;
  readonly tail: Float32Array;
  private readonly byName = new Map<string, number>();

  constructor(
    private readonly defs: BoneDef[],
    private readonly jointCubes: Record<string, number[]>,
  ) {
    this.bones = defs.map((d, i) => {
      const b = new THREE.Bone();
      b.name = d.name;
      this.byName.set(d.name, i);
      return b;
    });
    defs.forEach((d, i) => {
      if (d.parent >= 0) this.bones[d.parent].add(this.bones[i]);
    });
    this.root = this.bones[defs.findIndex((d) => d.parent < 0)];
    this.head = new Float32Array(defs.length * 3);
    this.tail = new Float32Array(defs.length * 3);
    this.skeleton = new THREE.Skeleton(this.bones, defs.map(() => new THREE.Matrix4()));
  }

  indexOf(name: string): number {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`unknown bone: ${name}`);
    return i;
  }

  bone(name: string): THREE.Bone {
    return this.bones[this.indexOf(name)];
  }

  private resolve(end: BoneEnd, verts: Float32Array, out: Float32Array, o: number): void {
    const list = end.cube ? this.jointCubes[end.cube] : end.verts!;
    let x = 0, y = 0, z = 0;
    for (const v of list) {
      x += verts[v * 3]; y += verts[v * 3 + 1]; z += verts[v * 3 + 2];
    }
    out[o] = x / list.length; out[o + 1] = y / list.length; out[o + 2] = z / list.length;
  }

  /** モーフ後の頂点からレスト姿勢を作り直す。ポーズ回転は保持される。 */
  updateRest(verts: Float32Array): void {
    this.defs.forEach((d, i) => {
      this.resolve(d.head, verts, this.head, i * 3);
      this.resolve(d.tail, verts, this.tail, i * 3);
    });
    this.defs.forEach((d, i) => {
      const hx = this.head[i * 3], hy = this.head[i * 3 + 1], hz = this.head[i * 3 + 2];
      if (d.parent >= 0) {
        const p = d.parent * 3;
        this.bones[i].position.set(hx - this.head[p], hy - this.head[p + 1], hz - this.head[p + 2]);
      } else {
        this.bones[i].position.set(hx, hy, hz);
      }
      this.skeleton.boneInverses[i].makeTranslation(-hx, -hy, -hz);
    });
  }

  headOf(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    return out.fromArray(this.head, this.indexOf(name) * 3);
  }

  tailOf(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    return out.fromArray(this.tail, this.indexOf(name) * 3);
  }

  /** レスト姿勢で from の根元から to の根元へ向かう単位ベクトル。 */
  dirBetween(from: string, to: string): THREE.Vector3 {
    return this.headOf(to).sub(this.headOf(from)).normalize();
  }

  resetPose(): void {
    for (const b of this.bones) b.quaternion.identity();
  }

  /**
   * 現在のポーズで頂点をCPUスキニングする（接地計算・パストレース用の焼き込みに使う）。
   * @param count 先頭から何頂点を処理するか
   */
  skin(src: Float32Array, skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>, out: Float32Array, count = src.length / 3): void {
    this.root.updateWorldMatrix(true, true);
    // ボーンの親（Humanのグループ）の変換は含めず、スケルトン空間での結果を返す
    const rootInv = new THREE.Matrix4();
    if (this.root.parent) rootInv.copy(this.root.parent.matrixWorld).invert();
    const mats = this.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(rootInv, b.matrixWorld).multiply(this.skeleton.boneInverses[i]).elements);
    for (let v = 0; v < count; v++) {
      const x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[v * 4 + k];
        if (w === 0) continue;
        const m = mats[skinIndex[v * 4 + k]];
        ox += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
        oy += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
        oz += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
    }
  }
}
