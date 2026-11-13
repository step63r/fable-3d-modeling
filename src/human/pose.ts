import * as THREE from 'three';
import type { Rig } from './skeleton';
import type { PoseState } from '../state';

/**
 * 関節の自由度（DOF）。角度は「解剖学的な絶対角」で表す（例: 腕の上げ 0°=真下, 90°=水平）。
 * ベースメッシュはAスタンス（腕約40°・肘約47°屈曲・脚約9°開き）なので、
 * rest にその角度を持たせ、(値 - rest) を実際の回転量にする。
 */
export interface DofDef {
  key: string;
  label: string;
  group: string;
  min: number;
  max: number;
  rest: number;
}

const sided = (key: string, label: string, group: string, min: number, max: number, rest = 0): DofDef[] => [
  { key: key + 'L', label: label + '（左）', group: group + '（左）', min, max, rest },
  { key: key + 'R', label: label + '（右）', group: group + '（右）', min, max, rest },
];

export const DOFS: DofDef[] = [
  { key: 'rootTurn', label: '体の向き', group: '全身', min: -180, max: 180, rest: 0 },
  { key: 'rootLean', label: '全身の前傾', group: '全身', min: -90, max: 90, rest: 0 },
  { key: 'rootSide', label: '全身の横傾き', group: '全身', min: -45, max: 45, rest: 0 },
  { key: 'waistBend', label: '腰の前後屈', group: '胴体', min: -30, max: 70, rest: 0 },
  { key: 'waistSide', label: '腰の側屈', group: '胴体', min: -35, max: 35, rest: 0 },
  { key: 'waistTwist', label: '腰のひねり', group: '胴体', min: -45, max: 45, rest: 0 },
  { key: 'chestBend', label: '胸の前後屈', group: '胴体', min: -25, max: 40, rest: 0 },
  { key: 'chestSide', label: '胸の側屈', group: '胴体', min: -25, max: 25, rest: 0 },
  { key: 'chestTwist', label: '胸のひねり', group: '胴体', min: -40, max: 40, rest: 0 },
  { key: 'neckBend', label: '首の前後屈', group: '首・頭', min: -40, max: 45, rest: 0 },
  { key: 'neckSide', label: '首の側屈', group: '首・頭', min: -35, max: 35, rest: 0 },
  { key: 'neckTwist', label: '首の回旋', group: '首・頭', min: -70, max: 70, rest: 0 },
  { key: 'headNod', label: '頭のうなずき', group: '首・頭', min: -30, max: 30, rest: 0 },
  { key: 'headTilt', label: '頭のかしげ', group: '首・頭', min: -30, max: 30, rest: 0 },
  ...sided('shrug', '肩の上げ', '腕', -15, 30),
  ...sided('armRaise', '腕の上げ（横）', '腕', -20, 180, 40),
  ...sided('armForward', '腕の振り（前後）', '腕', -70, 180),
  ...sided('armTwist', '上腕のひねり（内旋）', '腕', -90, 90),
  ...sided('elbow', '肘の曲げ', '腕', 0, 150, 47),
  ...sided('forearmTwist', '前腕のひねり', '腕', -90, 90),
  ...sided('wristBend', '手首の曲げ', '腕', -70, 70),
  ...sided('wristSide', '手首の横曲げ', '腕', -30, 30),
  ...sided('fingers', '指の握り', '腕', -10, 100),
  ...sided('thumb', '親指の曲げ', '腕', -20, 100),
  ...sided('hipFlex', '脚の上げ（前後）', '脚', -40, 130),
  ...sided('hipSpread', '脚の開き', '脚', -30, 70, 9),
  ...sided('hipTwist', '脚のひねり（外旋）', '脚', -45, 60),
  ...sided('knee', '膝の曲げ', '脚', 0, 150),
  ...sided('ankle', '足首（つま先下げ）', '脚', -35, 55),
];

const DOF_BY_KEY = new Map(DOFS.map((d) => [d.key, d]));

export interface PosePreset {
  id: string;
  label: string;
  angles: Record<string, number>;
}

/** 左右同じ値を両側に展開する。 */
const both = (a: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    out[k + 'L'] = v;
    out[k + 'R'] = v;
  }
  return out;
};

export const PRESETS: PosePreset[] = [
  { id: 'apose', label: 'Aポーズ', angles: {} },
  { id: 'tpose', label: 'Tポーズ', angles: { ...both({ armRaise: 90, elbow: 0, forearmTwist: 0, hipSpread: 4 }) } },
  {
    id: 'relaxed', label: '自然立ち',
    angles: { ...both({ armRaise: 9, armForward: 4, armTwist: 0, elbow: 14, fingers: 30, thumb: 15, hipSpread: 3.5, hipTwist: 6 }), neckBend: 2 },
  },
  {
    id: 'contrapposto', label: 'コントラポスト',
    angles: {
      rootSide: 4, waistSide: -7, chestSide: -5, chestTwist: -6, neckSide: 5, neckTwist: 8, headTilt: 3,
      armRaiseL: 10, elbowL: 18, fingersL: 30, thumbL: 15,
      armRaiseR: 40, armForwardR: -16, armTwistR: 55, elbowR: 96, forearmTwistR: 20, wristBendR: -25, fingersR: 25, thumbR: 10,
      hipSpreadL: -2, hipFlexL: -2, hipTwistL: 4,
      hipSpreadR: 12, hipFlexR: 12, kneeR: 22, hipTwistR: 18, ankleR: 8,
    },
  },
  {
    id: 'walk', label: '歩行',
    angles: {
      chestTwist: -8, waistTwist: 6, neckTwist: 2, rootLean: 3,
      armRaiseL: 8, armForwardL: 28, elbowL: 28, fingersL: 40, thumbL: 20,
      armRaiseR: 8, armForwardR: -24, elbowR: 16, fingersR: 40, thumbR: 20,
      hipSpreadL: 2, hipFlexL: -18, kneeL: 14, ankleL: 22,
      hipSpreadR: 2, hipFlexR: 30, kneeR: 12, ankleR: -12,
    },
  },
  {
    id: 'run', label: 'ランニング',
    angles: {
      rootLean: 12, chestTwist: -14, waistTwist: 8, neckBend: -8,
      armRaiseL: 10, armForwardL: 50, elbowL: 95, fingersL: 80, thumbL: 50,
      armRaiseR: 10, armForwardR: -45, elbowR: 85, fingersR: 80, thumbR: 50,
      hipSpreadL: 3, hipFlexL: -28, kneeL: 75, ankleL: 35,
      hipSpreadR: 3, hipFlexR: 62, kneeR: 70, ankleR: -5,
    },
  },
  {
    id: 'handsOnHips', label: '腰に手',
    angles: {
      ...both({ armRaise: 42, armForward: -18, armTwist: 58, elbow: 100, forearmTwist: -30, wristBend: -40, fingers: 25, thumb: -10, hipSpread: 12, hipTwist: 10 }),
      chestBend: -4,
    },
  },
  {
    id: 'wave', label: '手を振る',
    angles: {
      waistSide: 3, neckSide: -4, headTilt: -4,
      armRaiseL: 9, armForwardL: 4, elbowL: 14, fingersL: 30, thumbL: 15,
      armRaiseR: 105, armForwardR: 10, armTwistR: -75, elbowR: 85, forearmTwistR: 10, wristSideR: 10, fingersR: 0, thumbR: -10,
      ...both({ hipSpread: 4, hipTwist: 6 }),
    },
  },
  {
    id: 'cheer', label: 'バンザイ',
    angles: {
      chestBend: -8, neckBend: -10,
      ...both({ armRaise: 150, armForward: 10, armTwist: -30, elbow: 18, fingers: 0, thumb: -10, hipSpread: 10, hipTwist: 8 }),
    },
  },
  {
    id: 'think', label: '考える',
    angles: {
      neckBend: 8, neckTwist: -10, headTilt: 6, chestBend: 3,
      armRaiseL: 14, armForwardL: 38, armTwistL: 25, elbowL: 132, forearmTwistL: 40, wristBendL: 20, fingersL: 75, thumbL: 10,
      armRaiseR: 12, armForwardR: 22, armTwistR: 62, elbowR: 88, fingersR: 35, thumbR: 15,
      hipSpreadL: 3, hipSpreadR: 8, hipTwistR: 14, hipTwistL: 5,
    },
  },
  {
    id: 'sit', label: '座る（椅子）',
    angles: {
      waistBend: 6, chestBend: 2,
      ...both({ armRaise: 12, armForward: 30, elbow: 62, armTwist: 10, forearmTwist: 30, fingers: 20, thumb: 10, hipFlex: 86, hipSpread: 8, knee: 88, ankle: 0 }),
    },
  },
  {
    id: 'squat', label: 'しゃがむ',
    angles: {
      rootLean: 14, waistBend: 20, chestBend: 8, neckBend: -18,
      ...both({ armRaise: 14, armForward: 62, elbow: 30, fingers: 25, thumb: 10, hipFlex: 118, hipSpread: 22, hipTwist: 14, knee: 140, ankle: -30 }),
    },
  },
];

const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

/** プリセットと個別上書きを合成した、DOFの最終角度。 */
export function resolveAngle(pose: PoseState, key: string): number {
  const override = pose.angles[key];
  if (override !== undefined) return override;
  const preset = PRESET_BY_ID.get(pose.preset)?.angles[key];
  if (preset !== undefined) return preset;
  return DOF_BY_KEY.get(key)?.rest ?? 0;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const RAD = Math.PI / 180;
const rot = (axis: THREE.Vector3, deg: number) => new THREE.Quaternion().setFromAxisAngle(axis, deg * RAD);
/** 左右（YZ平面）で鏡映した回転。回転ベクトルは擬ベクトルなので y,z 成分の符号が反転する。 */
const mirror = (q: THREE.Quaternion) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);

export function applyPose(rig: Rig, pose: PoseState): void {
  rig.resetPose();
  const a = (key: string) => {
    const d = DOF_BY_KEY.get(key)!;
    const v = Math.min(d.max, Math.max(d.min, resolveAngle(pose, key)));
    return v - d.rest;
  };
  const set = (bone: string, q: THREE.Quaternion) => rig.bone(bone).quaternion.copy(q);

  // 前屈=+X回転、左への側屈=-Z回転、左へのひねり=+Y回転
  const torso = (bend: number, side: number, twist: number) => rot(Y, twist).multiply(rot(X, bend)).multiply(rot(Z, -side));
  set('root', torso(a('rootLean'), a('rootSide'), a('rootTurn')));
  for (const b of ['spine05', 'spine04', 'spine03']) set(b, torso(a('waistBend') / 3, a('waistSide') / 3, a('waistTwist') / 3));
  for (const b of ['spine02', 'spine01']) set(b, torso(a('chestBend') / 2, a('chestSide') / 2, a('chestTwist') / 2));
  for (const b of ['neck01', 'neck02', 'neck03']) set(b, torso(a('neckBend') / 3, a('neckSide') / 3, a('neckTwist') / 3));
  set('head', torso(a('headNod'), a('headTilt'), 0));

  // 左側のレスト形状から回転軸を求め、右側は鏡映で得る（メッシュは左右対称）
  const upperArm = rig.dirBetween('upperarm01.L', 'lowerarm01.L');
  const foreArm = rig.dirBetween('lowerarm01.L', 'wrist.L');
  const elbowAxis = new THREE.Vector3().crossVectors(upperArm, foreArm).normalize();
  const handDir = rig.dirBetween('wrist.L', 'finger3-1.L');
  const knuckle = rig.dirBetween('finger2-1.L', 'finger5-1.L');
  knuckle.addScaledVector(handDir, -knuckle.dot(handDir)).normalize();
  const palmNormal = new THREE.Vector3().crossVectors(handDir, knuckle).normalize();
  const thumbDir = rig.dirBetween('finger1-1.L', 'finger1-3.L');
  const thumbAxis = new THREE.Vector3().crossVectors(palmNormal, thumbDir).normalize();
  const thigh = rig.dirBetween('upperleg01.L', 'lowerleg01.L');

  for (const s of ['L', 'R'] as const) {
    const put = (bone: string, q: THREE.Quaternion) => set(`${bone}.${s}`, s === 'L' ? q : mirror(q));
    put('clavicle', rot(Z, a('shrug' + s)));
    // 横に上げてから前後に振る。腕を下ろした状態で前後スイングが効く順序
    put('upperarm01', rot(X, -a('armForward' + s)).multiply(rot(Z, a('armRaise' + s))));
    put('upperarm02', rot(upperArm, a('armTwist' + s)));
    put('lowerarm01', rot(elbowAxis, a('elbow' + s)));
    put('lowerarm02', rot(foreArm, a('forearmTwist' + s)));
    put('wrist', rot(knuckle, a('wristBend' + s)).multiply(rot(palmNormal, a('wristSide' + s))));
    const curl = a('fingers' + s) * 0.9;
    for (let f = 2; f <= 5; f++) {
      for (let j = 1; j <= 3; j++) put(`finger${f}-${j}`, rot(knuckle, curl * (j === 1 ? 0.85 : 1)));
    }
    const thumb = a('thumb' + s) * 0.5;
    put('finger1-1', rot(thumbAxis, thumb * 0.5));
    put('finger1-2', rot(thumbAxis, thumb));
    put('finger1-3', rot(thumbAxis, thumb));

    put('upperleg01', rot(X, -a('hipFlex' + s)).multiply(rot(Z, a('hipSpread' + s))));
    put('upperleg02', rot(thigh, -a('hipTwist' + s)));
    put('lowerleg01', rot(X, a('knee' + s)));
    put('foot', rot(X, a('ankle' + s)));
  }
}
