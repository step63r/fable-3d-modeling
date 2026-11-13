import * as THREE from 'three';
import './ui/style.css';
import { Human } from './human/human';
import { Stage } from './render/scene';
import { HighQualityRenderer } from './render/pathtrace';
import { defaultState, mergeState, type CharacterState } from './state';
import { buildPanel, download } from './ui/panel';
import { button, h } from './ui/controls';

const loadingText = document.getElementById('loading-text')!;

export type CameraPreset = 'full' | 'upper' | 'face';

export class App {
  state: CharacterState = defaultState();
  /** 状態が反映されるたびに呼ばれる */
  readonly listeners: (() => void)[] = [];
  readonly hq: HighQualityRenderer;
  private dirty = false;
  private running: Promise<void> | null = null;

  constructor(readonly stage: Stage, readonly human: Human) {
    this.hq = new HighQualityRenderer(stage);
  }

  /**
   * 状態を変更して反映する。
   * スライダー操作のように反映より速く変更が来る場合は、途中の状態を飛ばして最新だけを反映する。
   */
  commit(mutate?: (s: CharacterState) => void): Promise<void> {
    mutate?.(this.state);
    this.dirty = true;
    this.running ??= (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          await this.human.update(structuredClone(this.state));
          this.stage.setSubject(this.human.getBounds().getCenter(new THREE.Vector3()));
          for (const fn of this.listeners) fn();
        }
      } catch (e) {
        console.error(e);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  setState(raw: unknown): Promise<void> {
    this.state = mergeState(raw);
    return this.commit();
  }

  setCamera(preset: CameraPreset, azimuth = 0.22): void {
    const box = this.human.getBounds();
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (preset === 'full') {
      this.stage.frame(center, Math.max(size.y, size.x * 1.2), azimuth, 0.03);
    } else {
      const head = this.human.headCenter();
      if (preset === 'face') this.stage.frame(head, 0.36, azimuth, 0.0);
      else this.stage.frame(head.clone().add(new THREE.Vector3(0, -0.2, 0)), 0.8, azimuth, 0.02);
    }
  }

  savePng(name = 'character.png'): void {
    this.stage.canvas.toBlob((blob) => blob && download(name, blob), 'image/png');
  }

  /** パストレーシングを開始し、進捗オーバーレイを出す。指定サンプル数に達するか中断されると解決する。 */
  renderHighQuality(samples: number): Promise<void> {
    if (this.hq.active) return Promise.resolve();
    const viewport = document.getElementById('viewport')!;
    const status = h('span', {}, '準備中…');
    const bar = h('div', { class: 'bar' }, h('div', {}));
    const save = button('PNG保存', () => this.savePng('character_hq.png'));
    const overlay = h('div', { class: 'hq-overlay' }, h('div', { class: 'hq-box' }, status, bar, save, button('閉じる', () => finish())));
    document.body.classList.add('hq');
    viewport.append(overlay);
    this.stage.controls.enabled = false;

    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    let timer = 0;
    const finish = () => {
      clearInterval(timer);
      this.hq.stop();
      overlay.remove();
      document.body.classList.remove('hq');
      this.stage.controls.enabled = true;
      resolve();
    };
    // シーン構築（BVH生成）は重いので、オーバーレイを描画させてから始める
    setTimeout(() => {
      try {
        this.hq.start(samples);
      } catch (e) {
        console.error(e);
        status.textContent = 'パストレーシングを開始できませんでした';
        return;
      }
      const t0 = performance.now();
      timer = window.setInterval(() => {
        (bar.firstElementChild as HTMLElement).style.width = this.hq.progress * 100 + '%';
        const sec = ((performance.now() - t0) / 1000).toFixed(0);
        status.textContent = this.hq.done ? `完了（${this.hq.samples} サンプル / ${sec}秒）` : `レンダリング中… ${this.hq.samples} / ${samples} サンプル（${sec}秒）`;
        if (this.hq.done) {
          clearInterval(timer);
          overlay.dataset.done = '1';
        }
      }, 200);
    }, 50);
    return promise;
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const stage = new Stage(canvas);
  const human = await Human.load((t) => (loadingText.textContent = t));
  stage.scene.add(human.group);
  const app = new App(stage, human);
  loadingText.textContent = 'キャラクターを構築中…';
  await Promise.all([stage.setLighting('studio'), app.commit()]);
  app.setCamera('full');
  buildPanel(app, document.getElementById('panel')!);

  document.getElementById('loading')!.remove();
  const tick = () => {
    if (app.hq.active) app.hq.step();
    else stage.render();
    requestAnimationFrame(tick);
  };
  tick();
  // 検証スクリプト（tools/screenshot.mjs）から操作できるように公開する
  (window as unknown as { __app: App }).__app = app;
}

main().catch((e) => {
  console.error(e);
  loadingText.textContent = 'エラー: ' + (e instanceof Error ? e.message : String(e));
});
