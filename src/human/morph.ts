// スパースなモーフターゲットの合成（CPU）

export class TargetSet {
  constructor(
    private readonly index: Uint16Array,
    private readonly delta: Int16Array,
    private readonly quant: number,
    private readonly table: Record<string, [offset: number, count: number]>,
  ) {}

  has = (name: string): boolean => name in this.table;

  get names(): string[] {
    return Object.keys(this.table);
  }

  /** base に weights のターゲットを加算した結果を out に書く。 */
  apply(base: Float32Array, weights: Map<string, number>, out: Float32Array): void {
    out.set(base);
    const { index, delta } = this;
    for (const [name, w] of weights) {
      const entry = this.table[name];
      if (!entry || w === 0) continue;
      const s = w * this.quant;
      const end = entry[0] + entry[1];
      for (let i = entry[0]; i < end; i++) {
        const v = index[i] * 3;
        const d = i * 3;
        out[v] += delta[d] * s;
        out[v + 1] += delta[d + 1] * s;
        out[v + 2] += delta[d + 2] * s;
      }
    }
  }
}

/**
 * 位置を共有する頂点でスムーズ法線を計算する。
 * @param positions 頂点位置（頂点数×3）
 * @param tris 頂点indexの三角形リスト
 * @param out 法線の書き込み先（頂点数×3）
 */
export function computeVertexNormals(positions: Float32Array, tris: Uint32Array, out: Float32Array): void {
  out.fill(0);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    // 外積の大きさ=面積なので、正規化せず足すと面積重み付きになる
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l; out[i + 1] /= l; out[i + 2] /= l;
  }
}
