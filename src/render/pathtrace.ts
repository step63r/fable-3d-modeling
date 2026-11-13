import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import type { Stage } from './scene';

/**
 * GPUパストレーシングによる高品質静止画。
 * リアルタイム用の近似（影だけの床・加算合成の角膜）はパストレーサでは表現できないので、
 * 実行中だけパストレーサで扱える表現へ差し替える。
 */
export class HighQualityRenderer {
  private tracer?: WebGLPathTracer;
  private restore: (() => void)[] = [];
  private target = 0;
  private steps = 0;
  active = false;

  constructor(private readonly stage: Stage) {}

  get samples(): number {
    return this.tracer ? Math.floor(this.tracer.samples) : 0;
  }

  get done(): boolean {
    // steps を見るのは、前回のレンダリングのサンプル数が残っている開始直後を完了と誤認しないため
    return this.active && this.steps > 0 && this.samples >= this.target;
  }

  get progress(): number {
    return this.target ? Math.min(1, this.samples / this.target) : 0;
  }

  start(samples: number): void {
    const { stage } = this;
    this.target = samples;
    this.swapMaterials();
    stage.scene.updateMatrixWorld(true);
    this.tracer ??= new WebGLPathTracer(stage.renderer);
    const t = this.tracer;
    t.bounces = 5;
    t.transmissiveBounces = 6;
    t.filterGlossyFactor = 1;
    t.renderScale = 1;
    t.tiles.set(1, 1);
    t.dynamicLowRes = false;
    t.minSamples = 1;
    t.renderDelay = 0;
    t.fadeDuration = 0;
    t.rasterizeScene = false;
    // 肌・服のテクスチャ解像度を保つ（既定の1024だと顔がぼやける）
    t.textureSize.set(2048, 2048);
    t.setScene(stage.scene, stage.camera);
    t.reset();
    this.steps = 0;
    this.active = true;
  }

  /** 1フレーム分のサンプルを進める。 */
  step(): void {
    if (!this.tracer || !this.active) return;
    if (this.steps === 0 || this.samples < this.target) {
      this.tracer.renderSample();
      this.steps++;
    }
  }

  stop(): void {
    this.active = false;
    for (const fn of this.restore.splice(0)) fn();
  }

  private swapMaterials(): void {
    const { stage } = this;
    const floor = stage.floor;
    const original = floor.material;
    const bg = stage.scene.background instanceof THREE.Color ? stage.scene.background : new THREE.Color('#8a8a8a');
    const solid = new THREE.MeshStandardMaterial({ color: bg, roughness: 0.95 });
    floor.material = solid;
    this.restore.push(() => {
      floor.material = original;
      solid.dispose();
    });

    stage.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
      const original = o.material as THREE.Material;
      const physical = original as THREE.MeshPhysicalMaterial;
      if (physical.isMeshPhysicalMaterial && physical.transmission > 0) {
        // 眼鏡の透明レンズ: 屈折面は直接光を遮って顔に影を落としてしまうので、薄い半透明の面に置き換える
        const thin = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
        o.material = thin;
        this.restore.push(() => {
          o.material = original;
          thin.dispose();
        });
        return;
      }
      if (original.blending !== THREE.AdditiveBlending) return;
      // 角膜の反射レイヤは加算合成前提なので隠す。ガラスに置き換えると、パストレーサの直接光サンプリングが
      // 透過面を通らず虹彩が真っ暗になるため、代わりに眼球本体へクリアコートを付けて映り込みを出す
      o.visible = false;
      this.restore.push(() => (o.visible = true));
      const eye = o.parent?.children.find((c) => c.name === o.name.replace(':overlay', '')) as THREE.Mesh | undefined;
      const eyeMat = eye?.material as THREE.MeshPhysicalMaterial | undefined;
      if (eyeMat?.isMeshPhysicalMaterial) {
        eyeMat.clearcoat = 1;
        eyeMat.clearcoatRoughness = 0.03;
        this.restore.push(() => (eyeMat.clearcoat = 0));
      }
    });
  }
}
