import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { assetUrl } from '../human/assets';
import { setMaxAnisotropy } from './materials';

export interface LightingPreset {
  id: string;
  label: string;
  hdri: string;
  envIntensity: number;
  envRotation: number;
  background: 'hdri' | 'color';
  backgroundColor: string;
  key: { color: string; intensity: number; dir: [number, number, number] };
  fill: { color: string; intensity: number; dir: [number, number, number] };
  rim: { color: string; intensity: number; dir: [number, number, number] };
  exposure: number;
}

export const LIGHTING: LightingPreset[] = [
  {
    id: 'studio', label: 'スタジオ（ソフト）', hdri: 'hdri/studio_small_08_2k.hdr', envIntensity: 0.42, envRotation: 0.6,
    background: 'color', backgroundColor: '#8f9498',
    key: { color: '#fff4e8', intensity: 1.9, dir: [1.6, 2.6, 2.6] },
    fill: { color: '#dfe8ff', intensity: 0.2, dir: [-2.5, 1.2, 1.5] },
    rim: { color: '#ffffff', intensity: 0.9, dir: [-1.5, 2.2, -2.8] },
    exposure: 1.0,
  },
  {
    id: 'photo', label: 'フォトスタジオ（暖色）', hdri: 'hdri/brown_photostudio_02_2k.hdr', envIntensity: 0.6, envRotation: 2.2,
    background: 'color', backgroundColor: '#6f6660',
    key: { color: '#ffe9d2', intensity: 1.2, dir: [-1.8, 2.4, 2.4] },
    fill: { color: '#ffe6cf', intensity: 0.15, dir: [2.5, 1.0, 1.5] },
    rim: { color: '#fff1e0', intensity: 1.0, dir: [1.6, 2.4, -2.6] },
    exposure: 1.0,
  },
  {
    id: 'outdoor', label: '屋外（晴れ）', hdri: 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr', envIntensity: 0.6, envRotation: 0,
    background: 'hdri', backgroundColor: '#9db4cc',
    key: { color: '#fff1dc', intensity: 1.9, dir: [2.2, 3.0, 1.6] },
    fill: { color: '#cfe0ff', intensity: 0.2, dir: [-2, 1, 2] },
    rim: { color: '#ffffff', intensity: 0.4, dir: [-1, 2, -3] },
    exposure: 0.9,
  },
  {
    id: 'dramatic', label: 'ドラマチック', hdri: 'hdri/studio_small_08_2k.hdr', envIntensity: 0.18, envRotation: 3.4,
    background: 'color', backgroundColor: '#1b1c20',
    key: { color: '#ffe2c4', intensity: 2.4, dir: [2.8, 1.8, 1.2] },
    fill: { color: '#7fa0ff', intensity: 0.25, dir: [-2.5, 0.6, 1.5] },
    rim: { color: '#bcd4ff', intensity: 1.8, dir: [-2.2, 2.0, -2.2] },
    exposure: 1.05,
  },
];

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  readonly controls: OrbitControls;
  readonly key = new THREE.DirectionalLight();
  readonly fill = new THREE.DirectionalLight();
  readonly rim = new THREE.DirectionalLight();
  readonly floor: THREE.Mesh;
  lighting: LightingPreset = LIGHTING[0];
  aoEnabled = true;
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly hdrCache = new Map<string, Promise<THREE.DataTexture>>();
  private focus = new THREE.Vector3(0, 0.9, 0);

  constructor(readonly canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer: 画面をそのままPNG保存できるようにするため
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());

    this.camera.position.set(0, 1.0, 5.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 12;
    this.controls.target.copy(this.focus);

    for (const l of [this.key, this.fill, this.rim]) {
      this.scene.add(l);
      this.scene.add(l.target);
    }
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(4096, 4096);
    const sc = this.key.shadow.camera;
    sc.left = -1.4; sc.right = 1.4; sc.top = 1.4; sc.bottom = -1.4; sc.near = 0.5; sc.far = 12;
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.012;
    this.key.shadow.radius = 3;

    // 床は影だけを受ける。背景色と馴染ませるため実体は描かない
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.ShadowMaterial({ opacity: 0.38 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // MSAA付きのHDRターゲットに描いてからAO→トーンマッピングの順に後処理する
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 16 });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
  }

  resize(): void {
    const parent = this.canvas.parentElement!;
    const w = Math.max(1, parent.clientWidth), h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loadHdr(rel: string): Promise<THREE.DataTexture> {
    let p = this.hdrCache.get(rel);
    if (!p) {
      p = new HDRLoader().loadAsync(assetUrl(rel)).then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        return t;
      });
      this.hdrCache.set(rel, p);
    }
    return p;
  }

  async setLighting(id: string): Promise<void> {
    const preset = LIGHTING.find((l) => l.id === id) ?? LIGHTING[0];
    this.lighting = preset;
    const env = await this.loadHdr(preset.hdri);
    if (this.lighting !== preset) return;
    this.scene.environment = env;
    this.scene.environmentIntensity = preset.envIntensity;
    this.scene.environmentRotation.set(0, preset.envRotation, 0);
    if (preset.background === 'hdri') {
      this.scene.background = env;
      this.scene.backgroundRotation.set(0, preset.envRotation, 0);
      this.scene.backgroundBlurriness = 0.12;
    } else {
      this.scene.background = new THREE.Color(preset.backgroundColor);
    }
    this.renderer.toneMappingExposure = preset.exposure;
    const set = (light: THREE.DirectionalLight, s: LightingPreset['key']) => {
      light.color.set(s.color);
      light.intensity = s.intensity;
      light.userData.dir = new THREE.Vector3(...s.dir).normalize();
    };
    set(this.key, preset.key);
    set(this.fill, preset.fill);
    set(this.rim, preset.rim);
    this.aimLights();
  }

  /** ライトと影の範囲を被写体の位置に合わせる。 */
  setSubject(center: THREE.Vector3): void {
    this.focus.copy(center);
    this.aimLights();
  }

  private aimLights(): void {
    for (const l of [this.key, this.fill, this.rim]) {
      const dir = l.userData.dir as THREE.Vector3 | undefined;
      if (!dir) continue;
      l.target.position.copy(this.focus);
      l.position.copy(this.focus).addScaledVector(dir, 6);
    }
  }

  /** カメラを被写体の指定範囲に合わせる。 */
  frame(center: THREE.Vector3, height: number, azimuth = 0.25, elevation = 0.04): void {
    const dist = (height / 2) / Math.tan((this.camera.fov * Math.PI) / 360) * 1.18;
    const fit = Math.max(dist, (height * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360) / Math.min(1, this.camera.aspect) * 0.75);
    this.controls.target.copy(center);
    this.camera.position.set(
      center.x + Math.sin(azimuth) * Math.cos(elevation) * fit,
      center.y + Math.sin(elevation) * fit,
      center.z + Math.cos(azimuth) * Math.cos(elevation) * fit,
    );
    this.controls.update();
  }

  render(): void {
    this.controls.update();
    this.gtao.enabled = this.aoEnabled;
    this.composer.render();
  }
}
