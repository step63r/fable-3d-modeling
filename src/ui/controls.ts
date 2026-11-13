// 素のDOMで組む小さなUI部品群。各部品は refresh() で状態から表示を再同期できる。

export interface Control {
  el: HTMLElement;
  refresh(): void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step?: number;
  get(): number;
  set(v: number): void;
  format?(v: number): string;
  /** ダブルクリックで戻す既定値 */
  reset?: number;
}

export function slider(o: SliderOpts): Control {
  const input = h('input', { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step ?? 0.01) });
  const value = h('span', { class: 'value' });
  const fmt = o.format ?? ((v: number) => v.toFixed(2));
  const refresh = () => {
    const v = o.get();
    input.value = String(v);
    value.textContent = fmt(v);
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = fmt(v);
    o.set(v);
  });
  if (o.reset !== undefined) {
    input.addEventListener('dblclick', () => {
      o.set(o.reset!);
      refresh();
    });
    input.title = 'ダブルクリックで既定値に戻す';
  }
  const el = h('label', { class: 'row slider' }, h('span', { class: 'label' }, o.label), input, value);
  refresh();
  return { el, refresh };
}

export interface ColorOpts {
  label: string;
  swatches: string[];
  get(): string;
  set(v: string): void;
  /** 「元の色」を選べるようにする（値は ''） */
  allowNone?: boolean;
}

export function colorPicker(o: ColorOpts): Control {
  const wrap = h('div', { class: 'swatches' });
  const custom = h('input', { type: 'color', title: '任意の色' });
  const buttons: [string, HTMLElement][] = [];
  const add = (value: string, title: string) => {
    const b = h('button', { class: 'swatch' + (value ? '' : ' none'), title, type: 'button' });
    if (value) b.style.background = value;
    b.addEventListener('click', () => {
      o.set(value);
      refresh();
    });
    buttons.push([value, b]);
    wrap.append(b);
  };
  if (o.allowNone) add('', '元の色');
  for (const s of o.swatches) add(s, s);
  wrap.append(custom);
  custom.addEventListener('input', () => {
    o.set(custom.value);
    refresh();
  });
  const refresh = () => {
    const v = o.get();
    for (const [value, b] of buttons) b.classList.toggle('active', value.toLowerCase() === v.toLowerCase());
    if (v) custom.value = v;
  };
  const el = h('div', { class: 'row color' }, h('span', { class: 'label' }, o.label), wrap);
  refresh();
  return { el, refresh };
}

export interface ChoiceItem {
  id: string;
  label: string;
  thumb?: string | null;
}

export interface ChoiceOpts {
  label?: string;
  items: ChoiceItem[];
  get(): string;
  set(id: string): void;
  /** サムネイル付きのグリッド表示にするか、文字だけのチップ表示にするか */
  mode: 'grid' | 'chips';
}

export function choice(o: ChoiceOpts): Control {
  const wrap = h('div', { class: o.mode === 'grid' ? 'grid' : 'chips' });
  const buttons: [string, HTMLElement][] = [];
  for (const item of o.items) {
    const b = h('button', { class: 'item', type: 'button', title: item.label });
    if (o.mode === 'grid') {
      if (item.thumb) b.append(h('img', { src: item.thumb, alt: '', loading: 'lazy' }));
      else b.append(h('div', { class: 'noimg' }, item.id ? item.label.slice(0, 2) : '—'));
      b.append(h('span', {}, item.label));
    } else {
      b.textContent = item.label;
    }
    b.addEventListener('click', () => {
      o.set(item.id);
      refresh();
    });
    buttons.push([item.id, b]);
    wrap.append(b);
  }
  const refresh = () => {
    const v = o.get();
    for (const [id, b] of buttons) b.classList.toggle('active', id === v);
  };
  const el = h('div', { class: 'choice' });
  if (o.label) el.append(h('div', { class: 'sublabel' }, o.label));
  el.append(wrap);
  refresh();
  return { el, refresh };
}

export function section(title: string, controls: (Control | HTMLElement)[], open = true): { el: HTMLElement; controls: Control[] } {
  const details = h('details', { class: 'section' });
  if (open) details.open = true;
  details.append(h('summary', {}, title));
  const body = h('div', { class: 'section-body' });
  const list: Control[] = [];
  for (const c of controls) {
    if (c instanceof HTMLElement) body.append(c);
    else {
      body.append(c.el);
      list.push(c);
    }
  }
  details.append(body);
  return { el: details, controls: list };
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', { class: 'btn ' + cls, type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): Control {
  const input = h('input', { type: 'checkbox' });
  input.addEventListener('change', () => set(input.checked));
  const refresh = () => {
    input.checked = get();
  };
  refresh();
  return { el: h('label', { class: 'row check' }, input, h('span', {}, label)), refresh };
}
