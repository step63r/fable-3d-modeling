// 開発サーバ上のアプリをGPU有効のChromiumで開き、指定した状態のスクリーンショットを撮る検証スクリプト。
//   node tools/screenshot.mjs [シナリオ名の前方一致...]     （引数なしで全シナリオ）
// 事前に `pnpm dev` を起動しておくこと。URL は環境変数 APP_URL で変更できる。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'screenshots');
mkdirSync(outDir, { recursive: true });
const url = process.env.APP_URL ?? 'http://localhost:5173/';

const wanted = process.argv.slice(2);
const list = wanted.length ? SCENARIOS.filter((s) => wanted.some((w) => s.name.startsWith(w))) : SCENARIOS;

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  // ヘッドレスでも実GPU(ANGLE/D3D11)で描画させる
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__app, null, { timeout: 120000 });
console.log('renderer:', await page.evaluate(() => {
  const gl = window.__app.stage.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));

for (const sc of list) {
  const t0 = Date.now();
  const info = await page.evaluate(async (s) => {
    const app = window.__app;
    if (!s.keep) await app.setState(s.state ?? {});
    if (s.patch) {
      await app.commit((st) => {
        const merge = (dst, src) => {
          for (const [k, v] of Object.entries(src)) {
            if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') merge(dst[k], v);
            else dst[k] = v;
          }
        };
        merge(st, s.patch);
      });
    }
    if (s.lighting) await app.stage.setLighting(s.lighting);
    app.setCamera(s.camera ?? 'full', s.azimuth ?? 0.22);
    if (s.run) await new Function('app', 'return (async () => { ' + s.run + ' })()')(app);
    await new Promise((r) => setTimeout(r, s.wait ?? 500));
    return { height: app.human.heightCm };
  }, sc);
  const file = path.join(outDir, sc.name + '.png');
  const target = sc.fullPage ? page : page.locator('#viewport');
  await target.screenshot({ path: file });
  console.log(`${sc.name}: ${Date.now() - t0}ms height=${info.height.toFixed(1)}cm`);
}
if (errors.length) {
  console.log('--- console errors/warnings ---');
  for (const e of [...new Set(errors)].slice(0, 40)) console.log(e);
} else {
  console.log('console: no errors/warnings');
}
await browser.close();
