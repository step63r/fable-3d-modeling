# Fable 3D Modeling — キャラクタークリエイター

体型・外見・服・ポーズをカスタマイズできる、リアル志向の3D人体モデリングツール（Webアプリ）。
Three.js + TypeScript + Vite で実装し、人体・服・髪のデータには MakeHuman の CC0 アセットを使用している。

## セットアップ

前提: Node.js 22 以上、pnpm、WebGL2 対応ブラウザ（Chrome / Edge）。コマンドは PowerShell 7 で実行する。

```powershell
pnpm install
pnpm assets      # CC0アセットの取得(約350MB)と変換。初回のみ
pnpm dev         # http://localhost:5173/ を開く
```

`pnpm assets` は以下を `assets-src/` にダウンロードし、実行時用の形式に変換して `public/assets/` に出力する
（どちらも `.gitignore` 済み）。

| 取得元 | 内容 | ライセンス |
|---|---|---|
| github.com/makehumancommunity/mpfb2 | ベースメッシュ、モーフターゲット、リグ、スキンウェイト | CC0（アセット部分） |
| files.makehumancommunity.org `makehuman_system_assets_cc0.zip` | 肌テクスチャ、髪、服、靴、帽子、目、眉、まつ毛 | CC0 |
| polyhaven.com | HDRI 3種（studio_small_08 / brown_photostudio_02 / kloofendal_48d_partly_cloudy_puresky） | CC0 |

MakeHuman / MPFB のプログラムコード（AGPL / GPL）は使用していない。ファイル形式の読み込みやモーフ合成はすべて独自実装。

## 機能

| タブ | 内容 |
|---|---|
| 体型 | 性別、年齢(20〜90歳)、身長(cm指定)、体格(筋肉・体重)、プロポーション、肩幅、胸囲、ウエスト、ヒップ、足の長さ・太さ、腕の長さ・太さ、頭の大きさ、首、胴、お腹、お尻、バスト(カップ・張り・高さ・間隔)、人種ブレンド |
| 顔 | 顔の幅・長さ・輪郭、目(大きさ・開き・間隔・角度)、鼻(大きさ・幅・高さ)、口、頬、顎、耳、眉の形状、眉・まつ毛の種類 |
| 外見 | 肌の色、肌テクスチャ、髪型(10種)、髪色、瞳の色 |
| 服 | トップス / ボトムス / くつ / 帽子 / 眼鏡 の選択と色変更 |
| ポーズ | プリセット12種 + 関節ごとのFKスライダー(左右対称モードあり) |
| 撮影 | ライティング4種、カメラプリセット、PNG保存、GPUパストレーシングによる高品質レンダリング |

ヘッダの「保存 / 読込」でキャラクター設定を JSON として入出力できる。

## 構成

```
tools/
  fetch-assets.mjs    アセットのダウンロード・展開
  build-assets.mjs    assets-src → public/assets への変換（OBJ/target/mhclo → JSON+バイナリ）
  lib/parsers.mjs     OBJ / target / mhclo / mhmat パーサ
  screenshot.mjs      シナリオ(scenarios.mjs)ごとのスクリーンショット撮影
  ui-check.mjs        パネル操作の結合確認と性能計測
src/
  state.ts            キャラクター状態の定義・既定値・保存データの読込
  human/
    human.ts          人体の組み立て（モーフ→スケルトン→服のフィット→ポーズ→接地）
    macros.ts         性別・年齢・体格などマクロパラメータ → ターゲット重み
    modifiers.ts      個別スライダー → ターゲット重み
    morph.ts          スパースモーフの合成、法線計算
    skeleton.ts       関節位置の再計算、CPUスキニング
    proxy.ts          服・髪・目のフィッティングとスキンウェイト転写
    procedural.ts     体メッシュから切り出す手続き生成の衣類（Tシャツ・レギンス・下着・ニット帽）
    glasses.ts        眼鏡の手続き生成
    pose.ts           関節DOFの定義、プリセット、ボーン回転への変換
  render/
    scene.ts          レンダラ、HDRI・3灯照明、影、AO、カメラ
    materials.ts      肌(疑似SSS)・目・髪・布のマテリアル、テクスチャの染色
    pathtrace.ts      three-gpu-pathtracer による高品質静止画
  ui/                 パネル（素のDOM）
tests/                vitest によるユニットテスト
```

## 検証

```powershell
pnpm typecheck
pnpm test
pnpm build
# 以下は pnpm dev を起動した状態で実行（初回のみ: pnpm exec playwright install chromium）
node tools/ui-check.mjs          # UI操作の結合確認 + fps / 更新時間の計測
node tools/screenshot.mjs        # 全シナリオを screenshots/ に撮影（前方一致で絞り込み可: node tools/screenshot.mjs 50_pose）
```

## 既知の制限

- 髪・服のメッシュは MakeHuman 同梱アセット（ローポリ）のため、髪の生え際や布の厚みの表現は粗い。
- 上下別の服は、同梱の一体型スーツを連結成分で上下に分割したもの。「カジュアル A（メンズ）」は分割できないため上下一体として扱う。
- 手続き生成の衣類は体に密着する形状のみ（ゆとりのある服は作れない）。
- ポーズはFKのみ（IKなし）。布・髪の物理シミュレーションはなく、極端なポーズでは服や髪が体と干渉する。
- パストレーシングは初回のみシェーダコンパイルに数十秒かかる。肌の表面下散乱はリアルタイム描画のみの近似で、パストレーシングには反映されない。帽子着用時の髪の切り口はパストレーシングでは粗くなる。
- 子ども・乳児の体型は対象外（成人のみ）。
