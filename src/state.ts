// キャラクターの全パラメータ。JSON としてそのまま保存/読込できる形にしている。

export interface BodyState {
  /** 0=女性, 1=男性 */
  gender: number;
  /** 年齢 [歳]。成人のみ（20〜90） */
  age: number;
  /** 身長 [cm] */
  height: number;
  /** 筋肉量 0〜1 */
  muscle: number;
  /** 体重(脂肪量) 0〜1 */
  weight: number;
  /** プロポーション 0〜1（1=理想的な頭身） */
  proportions: number;
  /** バストのカップ 0〜1 / 張り 0〜1 */
  cup: number;
  firmness: number;
  /** 人種ブレンド（合計1に正規化して使う） */
  african: number;
  asian: number;
  caucasian: number;
  /** 個別スライダー（-1〜1）。キーは modifiers.ts の MODIFIERS */
  mods: Record<string, number>;
}

export interface LookState {
  skinTone: string;
  /** 肌テクスチャ: 'auto' または catalog.skins の id */
  skin: string;
  hair: string;
  hairColor: string;
  eyeColor: string;
  eyebrows: string;
  eyelashes: string;
}

export interface GarmentState {
  id: string;
  /** '' ならテクスチャ本来の色 */
  color: string;
}

export interface ClothesState {
  top: GarmentState;
  bottom: GarmentState;
  shoes: GarmentState;
  hat: GarmentState;
  glasses: GarmentState;
}

export interface PoseState {
  preset: string;
  /** 関節DOFの角度 [度]。キーは pose.ts の DOFS */
  angles: Record<string, number>;
}

export interface CharacterState {
  version: 1;
  body: BodyState;
  look: LookState;
  clothes: ClothesState;
  pose: PoseState;
}

export function defaultState(): CharacterState {
  return {
    version: 1,
    body: {
      gender: 0, age: 25, height: 163, muscle: 0.5, weight: 0.45, proportions: 0.75, cup: 0.5, firmness: 0.6,
      african: 0, asian: 1, caucasian: 0, mods: {},
    },
    look: {
      skinTone: '#e3b596', skin: 'auto', hair: 'hair_long01', hairColor: '#2a1d17', eyeColor: '#4a2c1a',
      eyebrows: 'eyebrow001', eyelashes: 'eyelashes01',
    },
    clothes: {
      top: { id: 'female_casualsuit01_top', color: '' },
      bottom: { id: 'female_casualsuit01_bottom', color: '' },
      shoes: { id: 'shoes01', color: '' },
      hat: { id: '', color: '' },
      glasses: { id: '', color: '' },
    },
    pose: { preset: 'relaxed', angles: {} },
  };
}

/** 保存データを既定値に重ねて読み込む（項目が増減しても壊れないように）。 */
export function mergeState(raw: unknown): CharacterState {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<CharacterState>;
  const garment = (d: GarmentState, s?: Partial<GarmentState>): GarmentState => ({ ...d, ...(s ?? {}) });
  return {
    version: 1,
    body: { ...base.body, ...(r.body ?? {}), mods: { ...(r.body?.mods ?? {}) } },
    look: { ...base.look, ...(r.look ?? {}) },
    clothes: {
      top: garment(base.clothes.top, r.clothes?.top),
      bottom: garment(base.clothes.bottom, r.clothes?.bottom),
      shoes: garment(base.clothes.shoes, r.clothes?.shoes),
      hat: garment(base.clothes.hat, r.clothes?.hat),
      glasses: garment(base.clothes.glasses, r.clothes?.glasses),
    },
    pose: { preset: r.pose?.preset ?? base.pose.preset, angles: { ...(r.pose?.angles ?? {}) } },
  };
}
