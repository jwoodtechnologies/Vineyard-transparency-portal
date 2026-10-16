/**
 * The car in Drive mode: a MapLibre custom 3D layer drawing the baked SUV model (carModel.ts; a box car of
 * the same size until the model has loaded) with plain WebGL, so no 3D library is needed. Shading is baked
 * into the colors once; each frame only moves one matrix.
 */
import * as maplibregl from 'maplibre-gl';
import { carMesh, type CarModel } from './carModel';
import type { Pos } from './graph';

export type CarKind = 'sedan' | 'suv' | 'hatch';

export const CAR_KINDS: Array<{ kind: CarKind; label: string }> = [
  { kind: 'sedan', label: 'Sedan' },
  { kind: 'suv', label: 'SUV' },
  { kind: 'hatch', label: 'Hatchback' },
];

export const CAR_COLORS: Array<{ key: string; label: string; hex: string }> = [
  { key: 'red', label: 'Red', hex: '#c62828' },
  { key: 'blue', label: 'Blue', hex: '#1f5fa8' },
  { key: 'white', label: 'White', hex: '#eeeeea' },
  { key: 'yellow', label: 'Yellow', hex: '#e8b21f' },
];

/** A box in meters: center x (right), y (forward), bottom z, and its width, length and height. */
interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  l: number;
  h: number;
  c: string;
}

const GLASS = '#26313b';
const TIRE = '#1b1b1d';

/** The boxes that make each car, about real size (a sedan is 1.8 m wide and 4.6 m long). */
export function carBoxes(kind: CarKind, color: string): Box[] {
  const s = {
    sedan: { w: 1.8, l: 4.6, bodyH: 0.75, cabW: 1.6, cabL: 2.4, cabH: 0.55, cabY: -0.2 },
    suv: { w: 1.9, l: 4.8, bodyH: 0.95, cabW: 1.75, cabL: 3.0, cabH: 0.7, cabY: -0.45 },
    hatch: { w: 1.75, l: 3.9, bodyH: 0.75, cabW: 1.58, cabL: 2.2, cabH: 0.6, cabY: -0.45 },
  }[kind];
  const lift = 0.32;
  const roof = shade(color, 0.72);
  const boxes: Box[] = [
    // Body, a darker lower band (bumpers and sills), the glass cabin and a roof darker than the body.
    { x: 0, y: 0, z: lift + 0.18, w: s.w, l: s.l, h: s.bodyH - 0.18, c: color },
    { x: 0, y: 0, z: lift, w: s.w + 0.02, l: s.l + 0.04, h: 0.2, c: '#2a2a2c' },
    { x: 0, y: s.cabY, z: lift + s.bodyH, w: s.cabW, l: s.cabL, h: s.cabH, c: GLASS },
    { x: 0, y: s.cabY, z: lift + s.bodyH + s.cabH, w: s.cabW - 0.04, l: s.cabL - 0.2, h: 0.07, c: roof },
    // Tail lights and headlights.
    { x: -(s.w / 2 - 0.3), y: -s.l / 2 - 0.01, z: lift + s.bodyH - 0.3, w: 0.42, l: 0.04, h: 0.16, c: '#d01414' },
    { x: s.w / 2 - 0.3, y: -s.l / 2 - 0.01, z: lift + s.bodyH - 0.3, w: 0.42, l: 0.04, h: 0.16, c: '#d01414' },
    { x: -(s.w / 2 - 0.3), y: s.l / 2 + 0.01, z: lift + s.bodyH - 0.3, w: 0.38, l: 0.04, h: 0.14, c: '#f2efe2' },
    { x: s.w / 2 - 0.3, y: s.l / 2 + 0.01, z: lift + s.bodyH - 0.3, w: 0.38, l: 0.04, h: 0.14, c: '#f2efe2' },
  ];
  // Wheels stand just outside the body, so they show from behind and from the side.
  const wx = s.w / 2 - 0.08,
    wy = s.l / 2 - 0.85;
  for (const [x, y] of [
    [-wx, wy],
    [wx, wy],
    [-wx, -wy],
    [wx, -wy],
  ])
    boxes.push({ x, y, z: 0, w: 0.3, l: 0.68, h: 0.66, c: TIRE });
  return boxes;
}

/** A color darker (k below 1) or lighter. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Triangles for the boxes: positions (x, y, z meters) and colors, each face shaded by where it faces. */
function mesh(boxes: Box[]): Float32Array {
  const out: number[] = [];
  for (const b of boxes) {
    const [r, g, bl] = rgb(b.c);
    const x0 = b.x - b.w / 2,
      x1 = b.x + b.w / 2,
      y0 = b.y - b.l / 2,
      y1 = b.y + b.l / 2,
      z0 = b.z,
      z1 = b.z + b.h;
    const quad = (a: number[], c: number[], d: number[], e: number[], shade: number) => {
      for (const p of [a, c, d, a, d, e]) out.push(p[0], p[1], p[2], r * shade, g * shade, bl * shade);
    };
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 1); // top
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0.9); // front
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.72); // back
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 0.78); // right
    quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], 0.7); // left
  }
  return new Float32Array(out);
}

/** Column-major 4x4 product a * b. */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

const VERT = `attribute vec3 a_pos; attribute vec3 a_col; uniform mat4 u_m; varying vec3 v_col;
void main() { v_col = a_col; gl_Position = u_m * vec4(a_pos, 1.0); }`;
const FRAG = `precision mediump float; varying vec3 v_col; void main() { gl_FragColor = vec4(v_col, 1.0); }`;

export interface CarLayer extends maplibregl.CustomLayerInterface {
  place(at: Pos, heading: number, elevation: number): void;
  setLook(kind: CarKind, color: string): void;
  /** Draw the baked model (in the current colour) instead of the boxes. */
  setModel(model: CarModel): void;
  /** Hidden while the camera is in the car. */
  setVisible(on: boolean): void;
}

export function carLayer(id: string, kind: CarKind, color: string): CarLayer {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let prog: WebGLProgram | null = null;
  let buf: WebGLBuffer | null = null;
  let count = 0;
  let model: CarModel | null = null;
  let look = { kind, color };
  const build = () => (model ? carMesh(model, look.color) : mesh(carBoxes(look.kind, look.color)));
  let data = build();
  let dirty = true;
  let pose: { at: Pos; heading: number; elevation: number } | null = null;
  let visible = true;
  let map: maplibregl.Map | null = null;
  const upload = () => {
    if (!gl || !buf) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    count = data.length / 6;
    dirty = false;
  };
  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, context) {
      map = m;
      gl = context;
      const sh = (t: number, src: string) => {
        const s = context.createShader(t)!;
        context.shaderSource(s, src);
        context.compileShader(s);
        return s;
      };
      prog = context.createProgram();
      if (!prog) return;
      context.attachShader(prog, sh(context.VERTEX_SHADER, VERT));
      context.attachShader(prog, sh(context.FRAGMENT_SHADER, FRAG));
      context.linkProgram(prog);
      buf = context.createBuffer();
      upload();
    },
    onRemove(_m, context) {
      if (buf) context.deleteBuffer(buf);
      if (prog) context.deleteProgram(prog);
      gl = null;
      map = null;
    },
    render(context, options) {
      if (!prog || !buf || !pose || !visible) return;
      if (dirty) upload();
      const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: pose.at[0], lat: pose.at[1] }, pose.elevation);
      const s = mc.meterInMercatorCoordinateUnits();
      const a = (-pose.heading * Math.PI) / 180;
      const c = Math.cos(a),
        si = Math.sin(a);
      // Translate to the car, scale meters to map units (y flipped: north is up), turn to the heading.
      const model = new Float32Array([c * s, -si * s, 0, 0, -si * s, -c * s, 0, 0, 0, 0, s, 0, mc.x, mc.y, mc.z, 1]);
      const m = mul(options.defaultProjectionData.mainMatrix as ArrayLike<number>, model);
      context.useProgram(prog);
      context.uniformMatrix4fv(context.getUniformLocation(prog, 'u_m'), false, m);
      context.bindBuffer(context.ARRAY_BUFFER, buf);
      const pos = context.getAttribLocation(prog, 'a_pos'),
        col = context.getAttribLocation(prog, 'a_col');
      context.enableVertexAttribArray(pos);
      context.enableVertexAttribArray(col);
      context.vertexAttribPointer(pos, 3, context.FLOAT, false, 24, 0);
      context.vertexAttribPointer(col, 3, context.FLOAT, false, 24, 12);
      context.enable(context.DEPTH_TEST);
      context.depthFunc(context.LEQUAL);
      context.disable(context.CULL_FACE);
      context.drawArrays(context.TRIANGLES, 0, count);
      context.disableVertexAttribArray(pos);
      context.disableVertexAttribArray(col);
    },
    place(at, heading, elevation) {
      pose = { at, heading, elevation };
    },
    setLook(k, col) {
      look = { kind: k, color: col };
      data = build();
      dirty = true;
      map?.triggerRepaint();
    },
    setModel(m) {
      model = m;
      data = build();
      dirty = true;
      map?.triggerRepaint();
    },
    setVisible(on) {
      visible = on;
    },
  };
}
