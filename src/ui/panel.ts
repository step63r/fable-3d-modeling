import type { App } from '../main';
import { MODIFIERS } from '../human/modifiers';
import { DOFS, PRESETS, resolveAngle } from '../human/pose';
import { LIGHTING } from '../render/scene';
import { assetUrl, type CatalogItem } from '../human/assets';
import { defaultState, type GarmentState } from '../state';
import { button, checkbox, choice, colorPicker, h, section, slider, type Control } from './controls';
import { randomize } from './random';

const SKIN_TONES = ['#f6dccb', '#efcbb0', '#e3b596', '#d6a27e', '#c08a63', '#a36f4b', '#84563a', '#63402c', '#472d20', '#2f1d15'];
const HAIR_COLORS = ['#0f0c0b', '#2a1d17', '#4a2f20', '#6b4423', '#8c5a2e', '#b07a3c', '#d4a95f', '#e8d3a0', '#7a2d1c', '#b5462a', '#8a8a8e', '#e6e6e6', '#3b5fa8', '#c2447e'];
const EYE_COLORS = ['#2b1a10', '#4a2c1a', '#6b4526', '#8a6a3a', '#5d7340', '#3f6f5a', '#4f7fa8', '#7aa7c9', '#8a939c', '#4a4f7a'];
const CLOTH_COLORS = ['#f2f2f0', '#1b1c20', '#5a5f6a', '#243a63', '#3f6fb0', '#7fb2d9', '#b0303a', '#e0734a', '#e3c458', '#4f8a5b', '#7a4fa0', '#e79ab8', '#c9b592', '#6b4a35'];

export function buildPanel(app: App, root: HTMLElement): void {
  root.textContent = '';
  const controls: Control[] = [];
  const reg = <T extends Control>(c: T): T => {
    controls.push(c);
    return c;
  };
  const refreshAll = () => controls.forEach((c) => c.refresh());
  const s = () => app.state;
  const none: CatalogItem = { id: '', label: 'なし' };
  const withThumbs = (items: CatalogItem[]) => items.map((i) => ({ ...i, thumb: i.thumb ? assetUrl(i.thumb) : null }));

  // ---------------------------------------------------------------- header
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      await app.setState(JSON.parse(await file.text()));
      refreshAll();
    } catch (e) {
      alert('読み込みに失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    }
    fileInput.value = '';
  });
  const header = h('div', { class: 'header' },
    h('div', { class: 'title' }, 'Fable 3D Modeling'),
    h('div', { class: 'actions' },
      button('ランダム', async () => {
        await app.commit((st) => randomize(st, app.human.catalog));
        refreshAll();
      }),
      button('リセット', async () => {
        await app.setState(defaultState());
        refreshAll();
      }),
      button('保存', () => download('character.json', new Blob([JSON.stringify(app.state, null, 2)], { type: 'application/json' }))),
      button('読込', () => fileInput.click()),
      fileInput,
    ),
  );

  // ---------------------------------------------------------------- tabs
  const tabs: { id: string; label: string; body: HTMLElement }[] = [];
  const tab = (id: string, label: string, ...children: HTMLElement[]) => {
    const body = h('div', { class: 'tab-body' }, ...children);
    tabs.push({ id, label, body });
  };
  const sec = (title: string, list: (Control | HTMLElement)[], open = true) => {
    const r = section(title, list, open);
    r.controls.forEach(reg);
    return r.el;
  };
  const pct = (v: number) => Math.round(v * 100) + '%';
  const signed = (v: number) => (v > 0 ? '+' : '') + Math.round(v * 100);

  const bodySlider = (label: string, key: 'gender' | 'muscle' | 'weight' | 'proportions' | 'cup' | 'firmness' | 'african' | 'asian' | 'caucasian', format = pct) =>
    slider({ label, min: 0, max: 1, step: 0.01, format, get: () => s().body[key], set: (v) => app.commit((st) => (st.body[key] = v)) });
  const modSlider = (key: string, label: string) =>
    slider({ label, min: -1, max: 1, step: 0.01, format: signed, reset: 0, get: () => s().body.mods[key] ?? 0, set: (v) => app.commit((st) => (st.body.mods[key] = v)) });

  tab('body', '体型',
    sec('基本', [
      bodySlider('性別', 'gender', (v) => (v < 0.35 ? '女性' : v > 0.65 ? '男性' : '中間') + ' ' + Math.round(v * 100)),
      slider({ label: '年齢', min: 20, max: 90, step: 1, format: (v) => v + '歳', get: () => s().body.age, set: (v) => app.commit((st) => (st.body.age = v)) }),
      slider({ label: '身長', min: 140, max: 205, step: 0.5, format: (v) => v.toFixed(1) + 'cm', get: () => s().body.height, set: (v) => app.commit((st) => (st.body.height = v)) }),
      bodySlider('体格（筋肉）', 'muscle'),
      bodySlider('体格（体重）', 'weight'),
      bodySlider('プロポーション', 'proportions'),
    ]),
    sec('各部のサイズ', MODIFIERS.filter((m) => m.group === 'body' && !m.key.startsWith('bust')).map((m) => modSlider(m.key, m.label))),
    sec('バスト', [
      bodySlider('バスト（カップ）', 'cup'),
      bodySlider('バスト（張り）', 'firmness'),
      ...MODIFIERS.filter((m) => m.key.startsWith('bust')).map((m) => modSlider(m.key, m.label)),
    ]),
    sec('人種ブレンド', [bodySlider('アジア系', 'asian'), bodySlider('ヨーロッパ系', 'caucasian'), bodySlider('アフリカ系', 'african')], false),
  );

  tab('face', '顔',
    sec('顔の造形', MODIFIERS.filter((m) => m.group === 'face').map((m) => modSlider(m.key, m.label))),
    sec('眉・まつ毛', [
      choice({ label: '眉', mode: 'chips', items: [none, ...app.human.catalog.eyebrows], get: () => s().look.eyebrows, set: (id) => app.commit((st) => (st.look.eyebrows = id)) }),
      choice({ label: 'まつ毛', mode: 'chips', items: [none, ...app.human.catalog.eyelashes], get: () => s().look.eyelashes, set: (id) => app.commit((st) => (st.look.eyelashes = id)) }),
    ]),
  );

  tab('look', '外見',
    sec('肌', [
      colorPicker({ label: '肌の色', swatches: SKIN_TONES, get: () => s().look.skinTone, set: (v) => app.commit((st) => (st.look.skinTone = v)) }),
      choice({
        label: '肌の質感（テクスチャ）', mode: 'chips',
        items: [{ id: 'auto', label: '自動（性別・年齢に連動）' }, ...app.human.catalog.skins.map((k) => ({ id: k.id, label: skinLabel(k) }))],
        get: () => s().look.skin, set: (id) => app.commit((st) => (st.look.skin = id)),
      }),
    ]),
    sec('髪', [
      choice({ label: '髪型', mode: 'grid', items: [none, ...withThumbs(app.human.catalog.hair)], get: () => s().look.hair, set: (id) => app.commit((st) => (st.look.hair = id)) }),
      colorPicker({ label: '髪色', swatches: HAIR_COLORS, get: () => s().look.hairColor, set: (v) => app.commit((st) => (st.look.hairColor = v)) }),
    ]),
    sec('瞳', [
      colorPicker({ label: '瞳の色', swatches: EYE_COLORS, get: () => s().look.eyeColor, set: (v) => app.commit((st) => (st.look.eyeColor = v)) }),
    ]),
  );

  const garment = (title: string, slot: keyof App['state']['clothes'], items: CatalogItem[], noneLabel = 'なし') => {
    const g = (st = s()): GarmentState => st.clothes[slot];
    return sec(title, [
      choice({ mode: 'grid', items: [{ id: '', label: noneLabel }, ...withThumbs(items)], get: () => g().id, set: (id) => app.commit((st) => (g(st).id = id)) }),
      colorPicker({ label: '色', swatches: CLOTH_COLORS, allowNone: true, get: () => g().color, set: (v) => app.commit((st) => (g(st).color = v)) }),
    ]);
  };
  const cat = app.human.catalog;
  tab('clothes', '服',
    garment('トップス', 'top', cat.tops, 'なし（下着）'),
    garment('ボトムス', 'bottom', cat.bottoms, 'なし（下着）'),
    garment('くつ', 'shoes', cat.shoes, 'はだし'),
    garment('帽子', 'hat', cat.hats),
    garment('眼鏡', 'glasses', cat.glasses),
  );

  // ---------------------------------------------------------------- pose
  let symmetric = true;
  const poseSlider = (key: string, label: string, min: number, max: number) =>
    slider({
      label, min, max, step: 1, format: (v) => Math.round(v) + '°',
      get: () => resolveAngle(s().pose, key),
      set: (v) => app.commit((st) => {
        st.pose.angles[key] = v;
        if (symmetric && /[LR]$/.test(key)) {
          const other = key.slice(0, -1) + (key.endsWith('L') ? 'R' : 'L');
          st.pose.angles[other] = v;
        }
      }).then(() => symmetric && poseControls.forEach((c) => c.refresh())),
    });
  const poseControls: Control[] = [];
  const groups = new Map<string, Control[]>();
  for (const d of DOFS) {
    const c = poseSlider(d.key, d.label, d.min, d.max);
    poseControls.push(c);
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group)!.push(c);
  }
  tab('pose', 'ポーズ',
    sec('プリセット', [
      choice({
        mode: 'chips', items: PRESETS.map((p) => ({ id: p.id, label: p.label })),
        get: () => (Object.keys(s().pose.angles).length ? '' : s().pose.preset),
        set: (id) => app.commit((st) => (st.pose = { preset: id, angles: {} })).then(refreshAll),
      }),
    ]),
    sec('関節の調整', [
      checkbox('左右対称に動かす', () => symmetric, (v) => (symmetric = v)),
      button('調整をリセット', () => app.commit((st) => (st.pose.angles = {})).then(refreshAll)),
      ...[...groups.entries()].map(([name, list]) => sec(name, list, name === '全身')),
    ]),
  );

  // ---------------------------------------------------------------- render
  let lighting = app.stage.lighting.id;
  const hq = { samples: 300 };
  tab('render', '撮影',
    sec('ライティング', [
      reg(choice({ mode: 'chips', items: LIGHTING.map((l) => ({ id: l.id, label: l.label })), get: () => lighting, set: (id) => { lighting = id; void app.stage.setLighting(id); } })),
      reg(checkbox('アンビエントオクルージョン', () => app.stage.aoEnabled, (v) => (app.stage.aoEnabled = v))),
    ]),
    sec('カメラ', [
      h('div', { class: 'btn-row' },
        button('全身', () => app.setCamera('full')),
        button('バストアップ', () => app.setCamera('upper')),
        button('顔', () => app.setCamera('face')),
      ),
      h('div', { class: 'hint' }, 'ドラッグ: 回転 / 右ドラッグ: 平行移動 / ホイール: ズーム'),
    ]),
    sec('出力', [
      h('div', { class: 'btn-row' }, button('画面をPNG保存', () => app.savePng())),
      reg(slider({ label: 'サンプル数', min: 50, max: 2000, step: 50, format: (v) => String(v), get: () => hq.samples, set: (v) => (hq.samples = v) })),
      h('div', { class: 'btn-row' }, button('高品質レンダリング（パストレーシング）', () => void app.renderHighQuality(hq.samples), 'primary')),
      h('div', { class: 'hint' }, '現在のカメラ・ポーズでGPUパストレーシングを行い、完了後にPNG保存できます。'),
    ]),
  );

  const tabBar = h('div', { class: 'tabs' });
  const content = h('div', { class: 'content' });
  const select = (id: string) => {
    for (const t of tabs) t.body.style.display = t.id === id ? '' : 'none';
    for (const b of tabBar.children) b.classList.toggle('active', (b as HTMLElement).dataset.id === id);
  };
  for (const t of tabs) {
    const b = h('button', { type: 'button', 'data-id': t.id }, t.label);
    b.addEventListener('click', () => select(t.id));
    tabBar.append(b);
    content.append(t.body);
  }
  root.append(header, tabBar, content);
  select('body');
  controls.push(...poseControls);

  const hud = document.getElementById('hud')!;
  const updateHud = () => {
    const b = app.state.body;
    hud.textContent = `身長 ${app.human.heightCm.toFixed(1)} cm ・ ${b.age} 歳`;
  };
  app.listeners.push(updateHud);
  updateHud();
  // 検証スクリプトからタブを切り替えられるようにする
  (root as HTMLElement & { selectTab?: (id: string) => void }).selectTab = select;
}

function skinLabel(k: { age: string; race: string; gender: string; variant: number }): string {
  const age = { young: '若年', middleage: '中年', old: '高齢' }[k.age] ?? k.age;
  const race = { asian: 'アジア系', caucasian: 'ヨーロッパ系', african: 'アフリカ系' }[k.race] ?? k.race;
  return `${race}・${k.gender === 'female' ? '女性' : '男性'}・${age}${k.variant > 1 ? ' B' : ''}`;
}

export function download(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
