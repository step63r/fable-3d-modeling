import type { Catalog } from '../human/assets';
import { MODIFIERS } from '../human/modifiers';
import type { CharacterState } from '../state';

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const rand = (min: number, max: number) => min + Math.random() * (max - min);
/** 中央寄りの乱数（極端な値が出にくい） */
const soft = (min: number, max: number) => min + ((Math.random() + Math.random() + Math.random()) / 3) * (max - min);

/** 体型・外見・服をランダムにする（ポーズはそのまま）。 */
export function randomize(st: CharacterState, catalog: Catalog): void {
  const male = Math.random() < 0.5;
  const b = st.body;
  b.gender = male ? rand(0.85, 1) : rand(0, 0.15);
  b.age = Math.round(soft(20, 75));
  b.height = Math.round(male ? soft(160, 190) : soft(148, 176));
  b.muscle = soft(0.2, 0.85);
  b.weight = soft(0.2, 0.8);
  b.proportions = soft(0.4, 1);
  b.cup = soft(0.2, 0.8);
  b.firmness = soft(0.3, 0.9);
  const race = pick(['asian', 'caucasian', 'african'] as const);
  b.asian = b.caucasian = b.african = 0.1;
  b[race] = 1;
  b.mods = {};
  for (const m of MODIFIERS) b.mods[m.key] = soft(-0.55, 0.55);

  const tones = { asian: ['#f0cdb2', '#e3b596', '#d6a27e'], caucasian: ['#f6dccb', '#efcbb0', '#e3b596'], african: ['#a36f4b', '#84563a', '#63402c', '#472d20'] };
  st.look.skinTone = pick(tones[race]);
  st.look.skin = 'auto';
  st.look.hair = pick(catalog.hair).id;
  st.look.hairColor = pick(b.age > 60 ? ['#8a8a8e', '#e6e6e6', '#4a2f20'] : ['#0f0c0b', '#2a1d17', '#4a2f20', '#6b4423', '#b07a3c', '#d4a95f', '#7a2d1c']);
  st.look.eyeColor = pick(['#2b1a10', '#4a2c1a', '#6b4526', '#5d7340', '#4f7fa8', '#8a939c']);
  st.look.eyebrows = pick(catalog.eyebrows).id;
  st.look.eyelashes = pick(catalog.eyelashes).id;

  const forGender = <T extends { gender?: string }>(list: T[]) => list.filter((i) => !i.gender || i.gender === (male ? 'male' : 'female'));
  st.clothes.top = { id: pick(forGender(catalog.tops)).id, color: '' };
  st.clothes.bottom = { id: pick(forGender(catalog.bottoms)).id, color: '' };
  st.clothes.shoes = { id: pick(catalog.shoes).id, color: '' };
  st.clothes.hat = { id: Math.random() < 0.2 ? pick(catalog.hats).id : '', color: '' };
  st.clothes.glasses = { id: Math.random() < 0.3 ? pick(catalog.glasses).id : '', color: '' };
}
