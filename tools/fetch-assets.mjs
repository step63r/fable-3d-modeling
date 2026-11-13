// CC0 アセットを assets-src/ に取得する。取得済みのものはスキップする。
import { createWriteStream, existsSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets-src');
mkdirSync(src, { recursive: true });

const SOURCES = [
  {
    name: 'mpfb2 (base mesh / targets / rig, CC0 assets)',
    url: 'https://codeload.github.com/makehumancommunity/mpfb2/tar.gz/refs/heads/master',
    file: 'mpfb2.tar.gz',
    extractTo: 'mpfb2',
    // リポジトリ全体は不要なので data 配下とライセンス文書だけ展開する
    // (bsdtar はパターンを既定でワイルドカードとして扱う)
    tarArgs: ['--strip-components=1', '*/src/mpfb/data/*', '*/LICENSE*'],
  },
  {
    name: 'MakeHuman system assets (skins / hair / clothes, CC0)',
    url: 'https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip',
    file: 'makehuman_system_assets_cc0.zip',
    extractTo: 'system_assets',
    tarArgs: [],
  },
  {
    name: 'Poly Haven HDRI: studio_small_08 (CC0)',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_08_2k.hdr',
    file: 'hdri/studio_small_08_2k.hdr',
  },
  {
    name: 'Poly Haven HDRI: kloofendal_48d_partly_cloudy_puresky (CC0)',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
    file: 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
  },
  {
    name: 'Poly Haven HDRI: brown_photostudio_02 (CC0)',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/brown_photostudio_02_2k.hdr',
    file: 'hdri/brown_photostudio_02_2k.hdr',
  },
];

async function download(url, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'asset-fetcher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  let got = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    got += c.length;
    if (got - last > 32 * 1024 * 1024) {
      last = got;
      console.log(`    ${(got / 1e6).toFixed(0)} MB${total ? ` / ${(total / 1e6).toFixed(0)} MB` : ''}`);
    }
  });
  // 中断時に壊れたファイルを「取得済み」と誤認しないよう、一時名で書いてから改名する
  const tmp = dest + '.part';
  await pipeline(body, createWriteStream(tmp));
  renameSync(tmp, dest);
}

for (const s of SOURCES) {
  const dest = path.join(src, s.file);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`skip (exists): ${s.name}`);
  } else {
    console.log(`download: ${s.name}`);
    await download(s.url, dest);
  }
  if (s.extractTo) {
    const out = path.join(src, s.extractTo);
    if (existsSync(out)) {
      console.log(`  skip extract (exists): ${s.extractTo}`);
      continue;
    }
    // 展開失敗時に中途半端なディレクトリが「展開済み」と誤認されないよう、一時名で展開してから改名する
    const tmpOut = out + '.part';
    rmSync(tmpOut, { recursive: true, force: true });
    mkdirSync(tmpOut, { recursive: true });
    console.log(`  extract -> ${s.extractTo}`);
    // Windows 10+ 同梱の bsdtar は tar.gz と zip の両方を展開できる
    execFileSync('tar', ['-xf', dest, '-C', tmpOut, ...s.tarArgs], { stdio: 'inherit' });
    renameSync(tmpOut, out);
  }
}
console.log('done');
