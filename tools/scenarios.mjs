// スクリーンショット検証のシナリオ定義。
//   state: 既定値へマージする状態 / patch: 直前の状態への差分 / keep: 直前の状態を引き継ぐ
//   run: ページ内で実行する追加コード（app を参照可）
const male = { body: { gender: 1, height: 176, cup: 0.5 }, look: { hair: 'hair_short02', skinTone: '#d6a27e' } };
const tab = (id) => `document.getElementById('panel').selectTab('${id}');`;

export const SCENARIOS = [
  { name: '01_default_full', camera: 'full' },
  { name: '02_default_face', camera: 'face', azimuth: 0.3 },
  { name: '03_default_upper', camera: 'upper' },
  { name: '04_ui_body', camera: 'full', fullPage: true, run: tab('body') },
  { name: '05_ui_clothes', camera: 'full', fullPage: true, run: tab('clothes') },
  { name: '06_ui_pose', camera: 'full', fullPage: true, run: tab('pose') },

  // 体型
  { name: '10_male_default', state: { ...male, clothes: { top: { id: 'male_casualsuit02_top' }, bottom: { id: 'male_casualsuit02_bottom' } } } },
  { name: '11_underwear_female', state: { clothes: { top: { id: '' }, bottom: { id: '' }, shoes: { id: '' } }, pose: { preset: 'apose' } } },
  { name: '12_underwear_male', state: { ...male, clothes: { top: { id: '' }, bottom: { id: '' }, shoes: { id: '' } }, pose: { preset: 'apose' } } },
  { name: '13_heavy', state: { body: { weight: 1, muscle: 0.3 }, clothes: { top: { id: 'proc_tank' }, bottom: { id: 'proc_shorts' }, shoes: { id: '' } } } },
  { name: '14_muscular_male', state: { ...male, body: { gender: 1, height: 185, muscle: 1, weight: 0.5 }, clothes: { top: { id: '' }, bottom: { id: 'proc_shorts' }, shoes: { id: '' } } } },
  { name: '15_old_male', state: { body: { gender: 1, age: 80, height: 168 }, look: { hair: 'hair_short04', hairColor: '#e6e6e6', skinTone: '#efcbb0' }, clothes: { top: { id: 'male_elegantsuit01_top' }, bottom: { id: 'male_elegantsuit01_bottom' }, shoes: { id: 'shoes03' } } }, camera: 'upper' },
  { name: '16_tall_short_a', state: { body: { height: 145 }, clothes: { top: { id: 'proc_tshirt' }, bottom: { id: 'proc_leggings' } } } },
  { name: '17_tall_short_b', state: { body: { height: 200, gender: 1 }, clothes: { top: { id: 'proc_tshirt' }, bottom: { id: 'proc_leggings' } } } },
  { name: '18_mods_max', state: { body: { mods: { shoulderWidth: 1, chest: 1, waist: -1, hips: 1, legLength: 1, legThickness: 1, armLength: 1, headSize: 1 } }, clothes: { top: { id: 'proc_tank' }, bottom: { id: 'proc_shorts' }, shoes: { id: '' } }, pose: { preset: 'apose' } } },
  { name: '19_mods_min', state: { body: { mods: { shoulderWidth: -1, chest: -1, waist: 1, hips: -1, legLength: -1, legThickness: -1, armLength: -1, headSize: -1 } }, clothes: { top: { id: 'proc_tank' }, bottom: { id: 'proc_shorts' }, shoes: { id: '' } }, pose: { preset: 'apose' } } },

  // 顔・外見
  { name: '20_face_mods_a', state: { body: { mods: { faceWidth: 1, eyeSize: 1, noseSize: 1 } } }, camera: 'face', azimuth: 0.2 },
  { name: '21_face_mods_b', state: { body: { mods: { faceWidth: -1, eyeSize: -1, noseSize: -1 } } }, camera: 'face', azimuth: 0.2 },
  { name: '22_look_caucasian', state: { body: { asian: 0, caucasian: 1 }, look: { skinTone: '#f6dccb', hair: 'hair_bob01', hairColor: '#d4a95f', eyeColor: '#4f7fa8' } }, camera: 'face', azimuth: 0.35 },
  { name: '23_look_african', state: { body: { asian: 0, african: 1, gender: 1, height: 180 }, look: { skinTone: '#63402c', hair: 'hair_afro01', hairColor: '#0f0c0b', eyeColor: '#2b1a10' }, clothes: { top: { id: 'proc_tshirt' } } }, camera: 'face', azimuth: -0.3 },
  { name: '24_look_colors', state: { look: { skinTone: '#c08a63', hair: 'hair_ponytail01', hairColor: '#b5462a', eyeColor: '#5d7340' } }, camera: 'face', azimuth: -0.35 },

  // 髪型
  ...['afro01', 'bob01', 'bob02', 'braid01', 'ponytail01', 'short01', 'short02', 'short03', 'short04'].map((id, i) => ({
    name: `30_hair_${id}`, state: { look: { hair: 'hair_' + id }, body: i > 4 ? { gender: 1 } : {} }, camera: 'upper', azimuth: 0.5,
  })),

  // 服
  ...[
    ['female_casualsuit02', 'shoes02'], ['female_elegantsuit01', 'shoes04'], ['female_sportsuit01', 'shoes05'],
  ].map(([s, shoes]) => ({ name: `40_clothes_${s}`, state: { clothes: { top: { id: s + '_top' }, bottom: { id: s + '_bottom' }, shoes: { id: shoes } } } })),
  ...[
    ['male_casualsuit01_bottom', ''], ['male_casualsuit03_top', 'male_casualsuit03_bottom'], ['male_casualsuit04_top', 'male_casualsuit04_bottom'],
    ['male_casualsuit05_top', 'male_casualsuit05_bottom'], ['male_casualsuit06_top', 'male_casualsuit06_bottom'],
    ['male_elegantsuit01_top', 'male_elegantsuit01_bottom'], ['male_worksuit01_top', 'male_worksuit01_bottom'],
  ].map(([t, b], i) => ({ name: `41_clothes_m${i}`, state: { ...male, clothes: { top: { id: t }, bottom: { id: b }, shoes: { id: 'shoes0' + ((i % 6) + 1) } } } })),
  { name: '42_proc_tshirt_leggings', state: { clothes: { top: { id: 'proc_tshirt', color: '' }, bottom: { id: 'proc_leggings' }, shoes: { id: 'shoes05' } } } },
  { name: '43_proc_longsleeve_capri', state: { clothes: { top: { id: 'proc_longsleeve' }, bottom: { id: 'proc_capri' }, shoes: { id: 'shoes02' } } } },
  { name: '44_proc_crop_shorts', state: { clothes: { top: { id: 'proc_croptop' }, bottom: { id: 'proc_shorts' }, shoes: { id: 'shoes06' } } } },
  { name: '45_recolor', state: { clothes: { top: { id: 'female_casualsuit01_top', color: '#b0303a' }, bottom: { id: 'female_casualsuit01_bottom', color: '#1b1c20' }, shoes: { id: 'shoes01', color: '#f2f2f0' } } } },
  { name: '46_hat_fedora', state: { clothes: { hat: { id: 'fedora01' } } }, camera: 'face', azimuth: 0.6 },
  { name: '46_hat_fedora_cocked', state: { clothes: { hat: { id: 'fedora_cocked' } }, look: { hair: 'hair_short02' }, body: { gender: 1 } }, camera: 'face', azimuth: -0.5 },
  { name: '47_hat_beanie', state: { clothes: { hat: { id: 'proc_beanie' } } }, camera: 'face', azimuth: 0.6 },
  { name: '47_hat_beanie_back', state: { clothes: { hat: { id: 'proc_beanie' } }, look: { hair: 'hair_bob02' } }, camera: 'face', azimuth: 2.4 },
  ...['glasses_square', 'glasses_round', 'glasses_oval', 'glasses_sun'].map((id, i) => ({
    name: `48_${id}`, state: { clothes: { glasses: { id } }, body: i % 2 ? { gender: 1 } : {}, look: i % 2 ? { hair: 'hair_short01' } : {} }, camera: 'face', azimuth: i < 2 ? 0.35 : -0.6,
  })),

  // ポーズ
  ...['apose', 'tpose', 'relaxed', 'contrapposto', 'walk', 'run', 'handsOnHips', 'wave', 'cheer', 'think', 'sit', 'squat'].map((id) => ({
    name: `50_pose_${id}`, state: { pose: { preset: id }, clothes: { top: { id: 'proc_tshirt' }, bottom: { id: 'proc_shorts' }, shoes: { id: 'shoes05' } } }, azimuth: 0.5,
  })),

  // 細部の確認
  { name: '55_hand_relaxed', state: { pose: { preset: 'relaxed' } }, run: "const p = app.human.rig.bone('wrist.L').getWorldPosition(new (app.stage.camera.position.constructor)()); app.stage.frame(p, 0.35, 1.0, 0.1);" },
  { name: '56_hand_fist', state: { pose: { preset: 'apose', angles: { fingersL: 100, thumbL: 100, fingersR: 100, thumbR: 100 } } }, run: "const p = app.human.rig.bone('wrist.L').getWorldPosition(new (app.stage.camera.position.constructor)()); app.stage.frame(p, 0.35, 0.6, 0.2);" },
  { name: '57_feet_jeans', run: "const p = app.human.rig.bone('foot.L').getWorldPosition(new (app.stage.camera.position.constructor)()); p.x = 0; app.stage.frame(p, 0.5, 0.5, 0.15);" },
  { name: '58_collar_male', state: { body: { gender: 1 }, look: { hair: 'hair_short01' } }, camera: 'face', azimuth: 0.4 },

  // ライティング
  ...['photo', 'outdoor', 'dramatic'].map((id) => ({ name: `60_light_${id}`, lighting: id, camera: 'upper', azimuth: 0.3 })),
  { name: '61_light_reset', lighting: 'studio' },

  // パストレーシング
  {
    name: '70_pathtrace', camera: 'upper', azimuth: 0.3, wait: 200,
    run: `const p = app.renderHighQuality(150); await new Promise((r) => { const t = setInterval(() => { if (app.hq.done) { clearInterval(t); r(); } }, 200); }); window.__hqPromise = p;`,
  },
  { name: '71_pathtrace_close', keep: true, run: `document.querySelectorAll('.hq-box .btn')[1].click(); await window.__hqPromise;` },
  { name: '72_pathtrace_face', keep: false, state: { clothes: { glasses: { id: 'glasses_round' } } }, camera: 'face', azimuth: 0.35, wait: 200,
    run: `app.renderHighQuality(40); await new Promise((r) => { const t = setInterval(() => { if (app.hq.done) { clearInterval(t); r(); } }, 200); });` },
];
