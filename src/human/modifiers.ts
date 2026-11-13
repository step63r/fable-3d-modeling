// UIの個別スライダー（-1〜1）と、decr/incr 対のターゲットとの対応表。

export interface ModifierDef {
  key: string;
  label: string;
  group: 'body' | 'face';
  /** [負側ターゲット, 正側ターゲット, 係数]。l-/r- の両側ターゲットは別々に列挙する */
  pairs: [neg: string, pos: string, factor?: number][];
}

const lr = (dir: string, stem: string, neg = 'decr', pos = 'incr', factor = 1): [string, string, number][] => [
  [`${dir}/l-${stem}-${neg}`, `${dir}/l-${stem}-${pos}`, factor],
  [`${dir}/r-${stem}-${neg}`, `${dir}/r-${stem}-${pos}`, factor],
];
const pair = (dir: string, stem: string, neg = 'decr', pos = 'incr', factor = 1): [string, string, number] => [
  `${dir}/${stem}-${neg}`, `${dir}/${stem}-${pos}`, factor,
];

export const MODIFIERS: ModifierDef[] = [
  // ---- 体型
  { key: 'shoulderWidth', label: '肩幅', group: 'body', pairs: [pair('torso', 'measure-shoulder-dist')] },
  { key: 'chest', label: '胸囲', group: 'body', pairs: [pair('torso', 'measure-bust-circ'), pair('torso', 'measure-underbust-circ', 'decr', 'incr', 0.6)] },
  { key: 'waist', label: 'ウエスト', group: 'body', pairs: [pair('torso', 'measure-waist-circ')] },
  { key: 'hips', label: 'ヒップ', group: 'body', pairs: [pair('torso', 'measure-hips-circ')] },
  { key: 'legLength', label: '足の長さ', group: 'body', pairs: [pair('legs', 'measure-upperleg-height'), pair('legs', 'measure-lowerleg-height')] },
  { key: 'legThickness', label: '足の太さ', group: 'body', pairs: [pair('legs', 'measure-thigh-circ'), pair('legs', 'measure-calf-circ'), pair('legs', 'measure-knee-circ', 'decr', 'incr', 0.6)] },
  { key: 'armLength', label: '腕の長さ', group: 'body', pairs: [pair('arms', 'measure-upperarm-length'), pair('arms', 'measure-lowerarm-length')] },
  { key: 'armThickness', label: '腕の太さ', group: 'body', pairs: [pair('arms', 'measure-upperarm-circ'), ...lr('arms', 'lowerarm-fat', 'decr', 'incr', 0.7)] },
  { key: 'headSize', label: '頭の大きさ', group: 'body', pairs: [pair('head', 'head-scale-horiz'), pair('head', 'head-scale-vert'), pair('head', 'head-scale-depth')] },
  { key: 'neckLength', label: '首の長さ', group: 'body', pairs: [pair('neck', 'measure-neck-height')] },
  { key: 'neckThickness', label: '首の太さ', group: 'body', pairs: [pair('neck', 'measure-neck-circ')] },
  { key: 'torsoLength', label: '胴の長さ', group: 'body', pairs: [pair('torso', 'measure-napetowaist-dist'), pair('torso', 'measure-waisttohip-dist', 'decr', 'incr', 0.6)] },
  { key: 'vshape', label: '逆三角形', group: 'body', pairs: [pair('torso', 'torso-vshape')] },
  { key: 'belly', label: 'お腹', group: 'body', pairs: [pair('stomach', 'stomach-tone', 'incr', 'decr'), pair('stomach', 'stomach-pregnant', 'decr', 'incr', 0.35)] },
  { key: 'buttocks', label: 'お尻', group: 'body', pairs: [pair('buttocks', 'buttocks-volume')] },
  { key: 'bustHeight', label: 'バストの高さ', group: 'body', pairs: [pair('breast', 'breast-trans', 'down', 'up')] },
  { key: 'bustDistance', label: 'バストの間隔', group: 'body', pairs: [pair('breast', 'breast-dist')] },

  // ---- 顔
  { key: 'faceWidth', label: '顔の幅', group: 'face', pairs: [pair('head', 'head-scale-horiz', 'decr', 'incr', 0.8), pair('head', 'head-fat', 'decr', 'incr', 0.5)] },
  { key: 'faceLength', label: '顔の長さ', group: 'face', pairs: [pair('head', 'head-scale-vert')] },
  { key: 'faceRound', label: '輪郭（シャープ↔丸）', group: 'face', pairs: [['head/head-invertedtriangular', 'head/head-round', 1]] },
  { key: 'eyeSize', label: '目の大きさ', group: 'face', pairs: lr('eyes', 'eye-scale') },
  { key: 'eyeHeight', label: '目の開き', group: 'face', pairs: lr('eyes', 'eye-height2') },
  { key: 'eyeDistance', label: '目の間隔', group: 'face', pairs: lr('eyes', 'eye-trans', 'in', 'out') },
  { key: 'eyeSlant', label: '目尻の角度', group: 'face', pairs: lr('eyes', 'eye-corner1', 'down', 'up') },
  { key: 'noseSize', label: '鼻の大きさ', group: 'face', pairs: [pair('nose', 'nose-scale-horiz'), pair('nose', 'nose-scale-vert'), pair('nose', 'nose-scale-depth')] },
  { key: 'noseWidth', label: '鼻の幅', group: 'face', pairs: [pair('nose', 'nose-width2'), pair('nose', 'nose-nostrils-width', 'decr', 'incr', 0.7)] },
  { key: 'noseHeight', label: '鼻の高さ', group: 'face', pairs: [pair('nose', 'nose-scale-depth'), pair('nose', 'nose-hump', 'decr', 'incr', 0.3)] },
  { key: 'mouthWidth', label: '口の幅', group: 'face', pairs: [pair('mouth', 'mouth-scale-horiz')] },
  { key: 'lipVolume', label: '唇の厚さ', group: 'face', pairs: [pair('mouth', 'mouth-upperlip-volume'), pair('mouth', 'mouth-lowerlip-volume')] },
  { key: 'mouthCorners', label: '口角', group: 'face', pairs: [pair('mouth', 'mouth-angles', 'down', 'up')] },
  { key: 'cheekBones', label: '頬骨', group: 'face', pairs: lr('cheek', 'cheek-bones') },
  { key: 'cheekVolume', label: '頬のふくらみ', group: 'face', pairs: lr('cheek', 'cheek-volume') },
  { key: 'chinWidth', label: '顎の幅', group: 'face', pairs: [pair('chin', 'chin-width')] },
  { key: 'chinHeight', label: '顎の長さ', group: 'face', pairs: [pair('chin', 'chin-height')] },
  { key: 'chinProminent', label: '顎の突出', group: 'face', pairs: [pair('chin', 'chin-prominent')] },
  { key: 'earSize', label: '耳の大きさ', group: 'face', pairs: lr('ears', 'ear-scale') },
  { key: 'browHeight', label: '眉の高さ', group: 'face', pairs: [pair('eyebrows', 'eyebrows-trans', 'down', 'up')] },
  { key: 'browAngle', label: '眉の角度', group: 'face', pairs: [pair('eyebrows', 'eyebrows-angle', 'down', 'up')] },
];

export function modifierWeights(mods: Record<string, number>, out: Map<string, number>): void {
  for (const def of MODIFIERS) {
    const v = Math.max(-1, Math.min(1, mods[def.key] ?? 0));
    if (Math.abs(v) < 1e-4) continue;
    for (const [neg, pos, factor = 1] of def.pairs) {
      const name = v < 0 ? neg : pos;
      // 複数スライダーが同じターゲットを使う場合があるので加算し、極端な変形を避けるため上限を設ける
      out.set(name, Math.min(1.5, (out.get(name) ?? 0) + Math.abs(v) * factor));
    }
  }
}
