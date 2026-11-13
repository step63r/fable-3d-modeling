// マクロパラメータ（性別・年齢・筋肉・体重・身長・プロポーション・人種・バスト）から
// macrodetail ターゲットの重みを求める。ターゲットは各要素の組合せ名で用意されているので、
// 要素ごとの補間係数の積を重みにする（多重線形補間）。

export interface MacroParams {
  gender: number;
  /** 0.5=young, 1=old（成人のみ扱う） */
  age: number;
  muscle: number;
  weight: number;
  /** 0〜1。0.5 が平均 */
  height: number;
  proportions: number;
  cup: number;
  firmness: number;
  african: number;
  asian: number;
  caucasian: number;
}

type Factors = [name: string, value: number][];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** min / average / max の3点補間。 */
function three(x: number, lo: string, mid: string, hi: string): Factors {
  x = clamp01(x);
  if (x < 0.5) return [[lo, 1 - 2 * x], [mid, 2 * x]];
  return [[mid, 2 - 2 * x], [hi, 2 * x - 1]];
}

/** 平均にはターゲットが無い（=ベース形状）要素。両端だけが重みを持つ。 */
function twoSided(x: number, lo: string, hi: string): Factors {
  x = clamp01(x);
  if (x < 0.5) return [[lo, 1 - 2 * x]];
  return [[hi, 2 * x - 1]];
}

/** 年齢 [歳] → マクロの age 値。young(0.5)=25歳、old(1.0)=90歳として線形に対応させる。 */
export function ageToMacro(years: number): number {
  return 0.5 + (clamp01((years - 25) / 65)) * 0.5;
}

export function macroWeights(p: MacroParams, has: (name: string) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string, w: number) => {
    if (w > 1e-4 && has(name)) out.set(name, (out.get(name) ?? 0) + w);
  };

  const g = clamp01(p.gender);
  const gender: Factors = [['female', 1 - g], ['male', g]];
  const t = clamp01((p.age - 0.5) * 2);
  const age: Factors = [['young', 1 - t], ['old', t]];
  const muscle = three(p.muscle, 'minmuscle', 'averagemuscle', 'maxmuscle');
  const weight = three(p.weight, 'minweight', 'averageweight', 'maxweight');
  const height = twoSided(p.height, 'minheight', 'maxheight');
  const prop = twoSided(p.proportions, 'uncommonproportions', 'idealproportions');
  const cup = three(p.cup, 'mincup', 'averagecup', 'maxcup');
  const firm = three(p.firmness, 'minfirmness', 'averagefirmness', 'maxfirmness');

  const raceSum = p.african + p.asian + p.caucasian;
  const race: Factors = raceSum > 1e-6
    ? [['african', p.african / raceSum], ['asian', p.asian / raceSum], ['caucasian', p.caucasian / raceSum]]
    : [['african', 1 / 3], ['asian', 1 / 3], ['caucasian', 1 / 3]];

  for (const [gn, gw] of gender) {
    for (const [an, aw] of age) {
      for (const [rn, rw] of race) add(`macro/${rn}-${gn}-${an}`, rw * gw * aw);
      for (const [mn, mw] of muscle) {
        for (const [wn, ww] of weight) {
          const base = gw * aw * mw * ww;
          const key = `${gn}-${an}-${mn}-${wn}`;
          add(`macro/universal-${key}`, base);
          for (const [hn, hw] of height) add(`height/${key}-${hn}`, base * hw);
          for (const [pn, pw] of prop) add(`proportions/${key}-${pn}`, base * pw);
          if (gn === 'female') {
            for (const [cn, cw] of cup) for (const [fn, fw] of firm) add(`breast/${key}-${cn}-${fn}`, base * cw * fw);
          }
        }
      }
    }
  }
  return out;
}
