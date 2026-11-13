import { describe, expect, it } from 'vitest';
import { parseObj, parseTarget, parseMhclo, parseMhmat, buildRenderMesh, connectedComponents } from '../tools/lib/parsers.mjs';

describe('parseObj', () => {
  it('頂点・UV・グループ付きの面を読む', () => {
    const obj = parseObj(['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'g body', 'f 1/1 2/2 3/3 4/4'].join('\n'));
    expect(obj.v).toHaveLength(4);
    expect(obj.vt[2]).toEqual([1, 1]);
    expect(obj.faces).toEqual([{ v: [0, 1, 2, 3], vt: [0, 1, 2, 3], group: 'body' }]);
  });
});

describe('parseTarget', () => {
  it('コメントと空行を無視してスパース差分を読む', () => {
    const t = parseTarget('# comment\n\n161 0 -.011 0\n184 0.5 -.005 1e-3\n');
    expect(t.index).toEqual([161, 184]);
    expect(t.delta).toEqual([0, -0.011, 0, 0.5, -0.005, 0.001]);
  });
});

describe('parseMhclo', () => {
  const text = [
    'name shirt', 'obj_file shirt.obj', 'x_scale 5399 11998 1.4340', 'z_scale 962 5320 2.0', 'y_scale 791 881 2.4',
    'verts 0', 'material shirt.mhmat',
    '10 11 12 0.5 0.25 0.25 0.01 0.02 0.03',
    '42',
    'delete_verts', '5 - 8 20', '30 - 31',
  ].join('\n');
  const clo = parseMhclo(text);

  it('verts の直後に material 行があっても頂点を取りこぼさない', () => {
    expect(clo.verts).toHaveLength(2);
    expect(clo.material).toBe('shirt.mhmat');
  });
  it('重心束縛と単一頂点束縛の両方を読む', () => {
    expect(clo.verts[0]).toEqual({ v: [10, 11, 12], w: [0.5, 0.25, 0.25], off: [0.01, 0.02, 0.03] });
    expect(clo.verts[1]).toEqual({ v: [42, 42, 42], w: [1, 0, 0], off: [0, 0, 0] });
  });
  it('delete_verts の範囲指定を展開する', () => {
    expect(clo.deleteVerts).toEqual([5, 6, 7, 8, 20, 30, 31]);
  });
  it('スケール参照を読む', () => {
    expect(clo.scale.x).toEqual({ v1: 5399, v2: 11998, den: 1.434 });
  });
});

describe('parseMhmat', () => {
  it('テクスチャ参照とフラグを読む', () => {
    const m = parseMhmat('name X\ntag a\ndiffuseTexture d.png\ntransparent True\nbackfaceCull False\nshaderParam foo bar');
    expect(m.diffuseTexture).toBe('d.png');
    expect(m.transparent).toBe('True');
    expect(m.backfaceCull).toBe('False');
    expect(m.shaderParam).toBeUndefined();
  });
});

describe('buildRenderMesh', () => {
  it('四角形を三角形化し、UVの継ぎ目で頂点を複製する', () => {
    const vt = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]];
    const mesh = buildRenderMesh(
      [{ v: [0, 1, 2, 3], vt: [0, 1, 2, 3] }, { v: [1, 4, 2], vt: [4, 1, 2] }],
      vt,
    );
    expect(mesh.index).toHaveLength(9);
    // 頂点1は UV 1 と UV 4 の2通りで使われるので複製される
    expect(mesh.rv2v.filter((v: number) => v === 1)).toHaveLength(2);
    expect(mesh.rv2v).toHaveLength(6);
  });
});

describe('connectedComponents', () => {
  it('面でつながった頂点を同じ成分にまとめる', () => {
    const comp = connectedComponents(6, [{ v: [0, 1, 2] }, { v: [2, 3] }, { v: [4, 5] }]);
    expect(new Set([comp[0], comp[1], comp[2], comp[3]]).size).toBe(1);
    expect(comp[4]).toBe(comp[5]);
    expect(comp[4]).not.toBe(comp[0]);
  });
});
