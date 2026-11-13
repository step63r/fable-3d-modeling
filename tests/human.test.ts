import { describe, expect, it } from 'vitest';
import { ageToMacro, macroWeights, type MacroParams } from '../src/human/macros';
import { MODIFIERS, modifierWeights } from '../src/human/modifiers';
import { TargetSet, computeVertexNormals } from '../src/human/morph';
import { fitProxyPositions, transferSkin } from '../src/human/proxy';
import { DOFS, PRESETS, resolveAngle } from '../src/human/pose';
import { defaultState, mergeState } from '../src/state';

const base: MacroParams = {
  gender: 0.3, age: 0.7, muscle: 0.35, weight: 0.8, height: 0.5, proportions: 0.5, cup: 0.5, firmness: 0.5,
  african: 0.2, asian: 0.5, caucasian: 0.3,
};
const all = () => true;
const sum = (m: Map<string, number>, prefix: string) => [...m].filter(([k]) => k.startsWith(prefix)).reduce((s, [, w]) => s + w, 0);

describe('macroWeights', () => {
  it('universal ターゲットの重みの総和は1（多重線形補間の分割）', () => {
    expect(sum(macroWeights(base, all), 'macro/universal-')).toBeCloseTo(1, 6);
  });
  it('人種ターゲットの重みの総和は1', () => {
    const w = macroWeights(base, all);
    expect(sum(w, 'macro/african-') + sum(w, 'macro/asian-') + sum(w, 'macro/caucasian-')).toBeCloseTo(1, 6);
  });
  it('平均身長・平均プロポーションではそれらのターゲットを使わない', () => {
    const w = macroWeights(base, all);
    expect(sum(w, 'height/')).toBe(0);
    expect(sum(w, 'proportions/')).toBe(0);
  });
  it('身長を上げると maxheight だけが効く', () => {
    const w = macroWeights({ ...base, height: 0.75 }, all);
    expect(sum(w, 'height/')).toBeCloseTo(0.5, 6);
    expect([...w.keys()].filter((k) => k.startsWith('height/')).every((k) => k.endsWith('maxheight'))).toBe(true);
  });
  it('バストのターゲットは女性側の重みの分だけ効く', () => {
    const w = macroWeights({ ...base, cup: 1, firmness: 1 }, all);
    expect(sum(w, 'breast/')).toBeCloseTo(1 - base.gender, 6);
    expect(sum(macroWeights({ ...base, gender: 1 }, all), 'breast/')).toBe(0);
  });
  it('存在しないターゲットは出力しない', () => {
    expect(macroWeights(base, () => false).size).toBe(0);
  });
  it('年齢は成人の範囲(0.5〜1)に収まる', () => {
    expect(ageToMacro(10)).toBe(0.5);
    expect(ageToMacro(25)).toBe(0.5);
    expect(ageToMacro(90)).toBe(1);
    expect(ageToMacro(200)).toBe(1);
  });
});

describe('modifierWeights', () => {
  it('符号に応じて decr / incr のどちらか一方だけを使う', () => {
    const neg = new Map<string, number>();
    modifierWeights({ waist: -0.5 }, neg);
    expect(neg.get('torso/measure-waist-circ-decr')).toBeCloseTo(0.5);
    expect(neg.has('torso/measure-waist-circ-incr')).toBe(false);
    const pos = new Map<string, number>();
    modifierWeights({ waist: 0.25 }, pos);
    expect(pos.get('torso/measure-waist-circ-incr')).toBeCloseTo(0.25);
  });
  it('範囲外の値は ±1 に丸める', () => {
    const out = new Map<string, number>();
    modifierWeights({ hips: 5 }, out);
    expect(out.get('torso/measure-hips-circ-incr')).toBe(1);
  });
  it('要件の項目がすべて定義されている', () => {
    const keys = MODIFIERS.map((m) => m.key);
    for (const k of ['shoulderWidth', 'chest', 'waist', 'hips', 'legLength', 'legThickness', 'armLength', 'headSize', 'faceWidth', 'eyeSize', 'noseSize']) {
      expect(keys).toContain(k);
    }
  });
});

describe('TargetSet', () => {
  it('スパース差分を重み付きで加算する', () => {
    const quant = 0.001;
    const set = new TargetSet(new Uint16Array([1, 2, 0]), new Int16Array([10, 0, 0, 0, 20, 0, 0, 0, -30]), quant, { a: [0, 2], b: [2, 1] });
    const src = new Float32Array(9);
    const out = new Float32Array(9);
    set.apply(src, new Map([['a', 0.5], ['b', 2], ['missing', 1]]), out);
    expect(out[3]).toBeCloseTo(0.005);
    expect(out[7]).toBeCloseTo(0.01);
    expect(out[2]).toBeCloseTo(-0.06);
    expect(src.every((x) => x === 0)).toBe(true);
  });
});

describe('computeVertexNormals', () => {
  it('XY平面上の三角形の法線は +Z', () => {
    const n = new Float32Array(9);
    computeVertexNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]), n);
    expect([...n]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });
});

describe('fitProxyPositions', () => {
  const verts = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2]);
  it('重心重みで補間し、軸別スケールを掛けたオフセットを足す', () => {
    const out = new Float32Array(3);
    // xスケール = |v1.x - v0.x| / den = 2 / 1 = 2
    fitProxyPositions(verts, [0, 1, 2], [0.5, 0.25, 0.25], [0.1, 0.1, 0.1], { x: { v1: 1, v2: 0, den: 1 }, y: null, z: null }, out);
    expect(out[0]).toBeCloseTo(0.5 + 0.2);
    expect(out[1]).toBeCloseTo(0.5 + 0.1);
    expect(out[2]).toBeCloseTo(0.1);
  });
  it('ベース形状が拡大されると束縛された頂点も追従する', () => {
    const scaled = verts.map((x) => x * 1.5);
    const a = new Float32Array(3), b = new Float32Array(3);
    const scale = { x: { v1: 1, v2: 0, den: 2 }, y: { v1: 2, v2: 0, den: 2 }, z: { v1: 3, v2: 0, den: 2 } };
    fitProxyPositions(verts, [1, 2, 3], [0.2, 0.3, 0.5], [0.1, -0.2, 0.3], scale, a);
    fitProxyPositions(scaled, [1, 2, 3], [0.2, 0.3, 0.5], [0.1, -0.2, 0.3], scale, b);
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k] * 1.5);
  });
});

describe('transferSkin', () => {
  it('束縛先のウェイトを混ぜて正規化し、負の重心重みは無視する', () => {
    const baseIndex = [0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0];
    const baseWeight = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const { skinIndex, skinWeight } = transferSkin(1, [0, 1, 2], [0.75, 0.25, -0.1], baseIndex, baseWeight);
    expect([...skinIndex.slice(0, 2)]).toEqual([0, 1]);
    expect(skinWeight[0]).toBeCloseTo(0.75);
    expect(skinWeight[1]).toBeCloseTo(0.25);
    expect(skinWeight[2]).toBe(0);
  });
});

describe('pose', () => {
  it('上書き > プリセット > レスト角 の順に解決する', () => {
    expect(resolveAngle({ preset: 'tpose', angles: {} }, 'armRaiseL')).toBe(90);
    expect(resolveAngle({ preset: 'tpose', angles: { armRaiseL: 10 } }, 'armRaiseL')).toBe(10);
    expect(resolveAngle({ preset: 'apose', angles: {} }, 'elbowL')).toBe(47);
    expect(resolveAngle({ preset: 'unknown', angles: {} }, 'kneeL')).toBe(0);
  });
  it('プリセットは定義済みのDOFだけを使い、可動域に収まっている', () => {
    const byKey = new Map(DOFS.map((d) => [d.key, d]));
    for (const p of PRESETS) {
      for (const [k, v] of Object.entries(p.angles)) {
        const d = byKey.get(k);
        expect(d, `${p.id}.${k}`).toBeDefined();
        expect(v, `${p.id}.${k}`).toBeGreaterThanOrEqual(d!.min);
        expect(v, `${p.id}.${k}`).toBeLessThanOrEqual(d!.max);
      }
    }
  });
});

describe('state', () => {
  it('欠けた項目は既定値で補い、未知の入力でも壊れない', () => {
    const s = mergeState({ body: { height: 180 }, clothes: { hat: { id: 'fedora01' } } });
    expect(s.body.height).toBe(180);
    expect(s.body.gender).toBe(defaultState().body.gender);
    expect(s.clothes.hat).toEqual({ id: 'fedora01', color: '' });
    expect(s.clothes.top).toEqual(defaultState().clothes.top);
    expect(mergeState(null)).toEqual(defaultState());
    expect(mergeState('garbage')).toEqual(defaultState());
  });
  it('保存→読込で元に戻る', () => {
    const s = defaultState();
    s.body.mods.waist = -0.4;
    s.pose.angles.kneeL = 30;
    expect(mergeState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
