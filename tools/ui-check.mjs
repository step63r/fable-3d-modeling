// UI操作の結合確認。パネルを実際にクリック/入力し、状態と表示が追従することを検証する。
//   node tools/ui-check.mjs      （事前に `pnpm dev` を起動しておく）
import { chromium } from 'playwright';

const url = process.env.APP_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__app, null, { timeout: 120000 });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failed++;
};
const state = () => page.evaluate(() => structuredClone(window.__app.state));
const idle = () => page.evaluate(() => window.__app.commit());
const tab = (label) => page.locator('.tabs button', { hasText: label }).click();
/** ラベルからスライダーを探し、input イベント付きで値を入れる */
const setSlider = async (label, value) => {
  const input = page.locator('.tab-body:visible .row.slider', { has: page.locator('.label', { hasText: new RegExp('^' + label + '$') }) }).locator('input');
  await input.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await idle();
};
const openAll = () => page.evaluate(() => document.querySelectorAll('.tab-body details').forEach((d) => (d.open = true)));

// ---- 体型
await tab('体型');
await openAll();
await setSlider('身長', 181);
check('身長スライダー → 状態', (await state()).body.height === 181);
check('身長スライダー → 実測値(HUD)', (await page.locator('#hud').textContent()).includes('181.0'));
await setSlider('性別', 1);
check('性別スライダー', (await state()).body.gender === 1);
for (const [label, key] of [['肩幅', 'shoulderWidth'], ['胸囲', 'chest'], ['ウエスト', 'waist'], ['ヒップ', 'hips'], ['足の長さ', 'legLength'], ['足の太さ', 'legThickness'], ['腕の長さ', 'armLength'], ['頭の大きさ', 'headSize']]) {
  await setSlider(label, 0.5);
  check(`${label}スライダー`, (await state()).body.mods[key] === 0.5);
}
await setSlider('バスト（カップ）', 0.8);
check('バストスライダー', (await state()).body.cup === 0.8);

// ---- 顔
await tab('顔');
for (const [label, key] of [['顔の幅', 'faceWidth'], ['目の大きさ', 'eyeSize'], ['鼻の大きさ', 'noseSize']]) {
  await setSlider(label, -0.5);
  check(`${label}スライダー`, (await state()).body.mods[key] === -0.5);
}

// ---- 外見
await tab('外見');
await page.locator('.tab-body:visible .grid .item', { hasText: 'ポニーテール' }).click();
await idle();
check('髪型の選択', (await state()).look.hair === 'hair_ponytail01');
const colorRow = (label) => page.locator('.tab-body:visible .row.color', { has: page.locator('.label', { hasText: label }) });
await colorRow('髪色').locator('.swatch').nth(6).click();
await idle();
check('髪色の選択', (await state()).look.hairColor === '#d4a95f');
await colorRow('肌の色').locator('.swatch').nth(5).click();
await idle();
check('肌の色の選択', (await state()).look.skinTone === '#a36f4b');
await colorRow('瞳の色').locator('.swatch').nth(6).click();
await idle();
check('瞳の色の選択', (await state()).look.eyeColor === '#4f7fa8');

// ---- 服
await tab('服');
const sectionOf = (title) => page.locator('.tab-body:visible > details', { has: page.locator('summary', { hasText: new RegExp('^' + title + '$') }) });
for (const [title, slot, label, id] of [
  ['トップス', 'top', 'タンクトップ', 'proc_tank'], ['ボトムス', 'bottom', 'レギンス', 'proc_leggings'], ['くつ', 'shoes', 'シューズ 3', 'shoes03'],
  ['帽子', 'hat', 'ニット帽', 'proc_beanie'], ['眼鏡', 'glasses', 'ラウンド', 'glasses_round'],
]) {
  await sectionOf(title).locator('.grid .item', { hasText: label }).first().click();
  await idle();
  check(`${title}の選択`, (await state()).clothes[slot].id === id);
}
await sectionOf('トップス').locator('.swatch').nth(7).click();
await idle();
check('服の色変更', (await state()).clothes.top.color === '#b0303a');
const meshes = await page.evaluate(() => window.__app.human.meshes().map((m) => m.name));
check('選んだ服がシーンに存在する', ['proc_tank', 'proc_leggings', 'shoes03', 'proc_beanie'].every((id) => meshes.includes(id)), meshes.join(','));

// ---- ポーズ
await tab('ポーズ');
await page.locator('.tab-body:visible .chips .item', { hasText: '歩行' }).click();
await idle();
check('ポーズプリセット', (await state()).pose.preset === 'walk');
await openAll();
await setSlider('膝の曲げ（左）', 60);
const pose = (await state()).pose;
check('関節スライダー（左右対称）', pose.angles.kneeL === 60 && pose.angles.kneeR === 60);
const kneeQ = await page.evaluate(() => window.__app.human.rig.bone('lowerleg01.L').quaternion.toArray());
check('関節スライダー → ボーン回転', Math.abs(kneeQ[0] - Math.sin((60 * Math.PI) / 360)) < 1e-3, kneeQ.map((x) => x.toFixed(3)).join(','));

// ---- 撮影
await tab('撮影');
await page.locator('.tab-body:visible .chips .item', { hasText: 'ドラマチック' }).click();
await page.waitForTimeout(500);
check('ライティング切替', (await page.evaluate(() => window.__app.stage.lighting.id)) === 'dramatic');
const [png] = await Promise.all([page.waitForEvent('download'), page.locator('.btn', { hasText: '画面をPNG保存' }).click()]);
check('PNG保存', png.suggestedFilename() === 'character.png');

// ---- ヘッダ
const [json] = await Promise.all([page.waitForEvent('download'), page.locator('.header .btn', { hasText: '保存' }).click()]);
check('JSON保存', json.suggestedFilename() === 'character.json');
const saved = await state();
await page.locator('.header .btn', { hasText: 'ランダム' }).click();
await idle();
check('ランダム', JSON.stringify(await state()) !== JSON.stringify(saved));
await page.locator('input[type=file]').setInputFiles(await json.path());
await page.waitForTimeout(800);
await idle();
check('JSON読込で保存時の状態に戻る', JSON.stringify(await state()) === JSON.stringify(saved));
await page.locator('.header .btn', { hasText: 'リセット' }).click();
await idle();
const def = await state();
check('リセット', def.body.height === 163 && def.pose.preset === 'relaxed' && def.clothes.hat.id === '');

// ---- 性能
const perf = await page.evaluate(async () => {
  const app = window.__app;
  const frames = await new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    const loop = () => {
      n++;
      if (performance.now() - t0 < 2000) requestAnimationFrame(loop);
      else resolve(n / 2);
    };
    requestAnimationFrame(loop);
  });
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) await app.commit((s) => (s.body.height = 160 + i));
  const body = (performance.now() - t0) / 20;
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) await app.commit((s) => (s.pose.angles.kneeL = i));
  const pose = (performance.now() - t1) / 20;
  return { fps: frames, body, pose };
});
console.log(`perf: ${perf.fps.toFixed(0)} fps / 体型更新 ${perf.body.toFixed(1)} ms / ポーズ更新 ${perf.pose.toFixed(1)} ms`);

check('コンソールエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
