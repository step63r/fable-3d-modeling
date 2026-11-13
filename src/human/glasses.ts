// 眼鏡（手続き生成）。頭部ボーンに剛体として取り付け、顔のランドマークに合わせて寸法を決める。
import * as THREE from 'three';
import type { CatalogItem } from './assets';

export interface GlassesDef extends CatalogItem {
  /** レンズの半幅・半高 [m]（瞳孔間距離 62mm のときの値） */
  a: number;
  b: number;
  /** スーパー楕円の指数。2=楕円、大きいほど四角い */
  exponent: number;
  rim: number;
  frameColor: string;
  metal: boolean;
  /** レンズの色。null なら透明レンズ */
  tint: string | null;
}

export const GLASSES: GlassesDef[] = [
  { id: 'glasses_square', label: 'ウェリントン', a: 0.0245, b: 0.0195, exponent: 3.6, rim: 0.0019, frameColor: '#16161a', metal: false, tint: null },
  { id: 'glasses_round', label: 'ラウンド', a: 0.0215, b: 0.0212, exponent: 2, rim: 0.0011, frameColor: '#b8975a', metal: true, tint: null },
  { id: 'glasses_oval', label: 'オーバル（メタル）', a: 0.025, b: 0.016, exponent: 2.4, rim: 0.0009, frameColor: '#9a9da3', metal: true, tint: null },
  { id: 'glasses_sun', label: 'サングラス', a: 0.027, b: 0.0225, exponent: 3, rim: 0.0018, frameColor: '#101012', metal: false, tint: '#15171b' },
];

export interface GlassesLandmarks {
  /** 左目の中心・鼻筋（目の高さ）・左耳の付け根上部。レスト姿勢の座標 */
  eye: THREE.Vector3;
  bridge: THREE.Vector3;
  ear: THREE.Vector3;
}

const tube = (points: THREE.Vector3[], radius: number, closed = false) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5), Math.max(24, points.length * 4), radius, 10, closed);

export function buildGlasses(def: GlassesDef, lm: GlassesLandmarks, color: string): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: color || def.frameColor,
    metalness: def.metal ? 1 : 0,
    roughness: def.metal ? 0.25 : 0.35,
    clearcoat: def.metal ? 0 : 0.8,
    clearcoatRoughness: 0.15,
  });
  const lensMat = def.tint
    ? new THREE.MeshPhysicalMaterial({ color: def.tint, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.9, specularIntensity: 1, side: THREE.DoubleSide })
    : new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0, transmission: 1, ior: 1.5, thickness: 0.0015, specularIntensity: 1, side: THREE.DoubleSide });

  const k = lm.eye.x / 0.031;
  const a = def.a * k, b = def.b * k;
  // レンズ面は鼻筋より少し前。まつ毛に当たらないよう目からも離す
  const z = Math.max(lm.bridge.z + 0.007, lm.eye.z + 0.024);
  const cx = Math.max(lm.eye.x, a + 0.0085 * k);
  const cy = lm.eye.y - 0.003 * k;
  const wrap = 0.1; // 顔のカーブに沿わせるレンズの回り込み [rad]

  for (const side of [1, -1]) {
    const lens = new THREE.Group();
    lens.position.set(cx * side, cy, z);
    lens.rotation.set(-0.12, wrap * side, 0);
    group.add(lens);

    const outline: THREE.Vector3[] = [];
    const N = 48;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      const e = 2 / def.exponent;
      outline.push(new THREE.Vector3(Math.sign(c) * Math.pow(Math.abs(c), e) * a, Math.sign(s) * Math.pow(Math.abs(s), e) * b, 0));
    }
    const rim = new THREE.Mesh(tube(outline, def.rim, true), frameMat);
    lens.add(rim);

    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)));
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(shape), lensMat);
    glass.userData.noShadow = true;
    lens.add(glass);

    // つる: 智（レンズ外端）から耳の付け根へ伸び、耳の後ろで下へ曲がる
    lens.updateMatrix();
    const hinge = new THREE.Vector3((a + def.rim) * side, b * 0.45, 0).applyMatrix4(lens.matrix);
    const ear = new THREE.Vector3((lm.ear.x + 0.003) * side, lm.ear.y + 0.004, lm.ear.z);
    const temple = [
      hinge,
      new THREE.Vector3(hinge.x + 0.004 * side, hinge.y, hinge.z - 0.012),
      new THREE.Vector3((hinge.x * 0.4 + ear.x * 0.6), (hinge.y + ear.y) / 2, (hinge.z + ear.z) / 2),
      ear,
      new THREE.Vector3(ear.x - 0.002 * side, ear.y - 0.006, ear.z - 0.016),
      new THREE.Vector3(ear.x - 0.005 * side, ear.y - 0.024, ear.z - 0.026),
    ];
    group.add(new THREE.Mesh(tube(temple, def.rim * 0.85), frameMat));
  }

  // ブリッジ
  const inner = cx - a * Math.cos(wrap);
  const bridge = [
    new THREE.Vector3(-inner, cy + b * 0.35, z + 0.0015),
    new THREE.Vector3(-inner * 0.45, cy + b * 0.5, z + 0.004),
    new THREE.Vector3(inner * 0.45, cy + b * 0.5, z + 0.004),
    new THREE.Vector3(inner, cy + b * 0.35, z + 0.0015),
  ];
  group.add(new THREE.Mesh(tube(bridge, def.rim * 0.9), frameMat));

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = !o.userData.noShadow;
      o.receiveShadow = !o.userData.noShadow;
    }
  });
  group.userData.dispose = () => {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    frameMat.dispose();
    lensMat.dispose();
  };
  return group;
}
