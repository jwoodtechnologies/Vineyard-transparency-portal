/**
 * Zoning in the street photos: a MapillaryJS custom renderer that draws each nearby zoning district as a
 * translucent fill on the ground with its boundary line, in the district's map color, plus the outline
 * of the parcel under the pin. Points are placed with MapillaryJS's geodeticToEnu (meters east, north and
 * up from the viewer's reference), on the ground about two meters below the camera. Part of the viewer's
 * own chunk.
 */
import earcut from 'earcut';
import { geodeticToEnu, RenderPass, type ICustomRenderer, type IViewer, type LngLatAlt } from 'mapillary-js';
import { distance } from '../measure/geo';
import { ringToLocal, type Pos } from './geo';

export interface District {
  zone: string;
  color: string;
  /** Outer rings, each closed or not. */
  rings: Pos[][];
}

/** Districts this far from the camera are left out (the far ground is a sliver near the horizon). */
const REACH_M = 300;
/** A camera on a car or a person's head is about this high. */
const CAMERA_HEIGHT_M = 2;

const VERT = `attribute vec3 a_pos;
uniform mat4 u_view;
uniform mat4 u_proj;
void main() { gl_Position = u_proj * u_view * vec4(a_pos, 1.0); }`;
const FRAG = `precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

interface Mesh {
  color: [number, number, number];
  fill: WebGLBuffer;
  fillCount: number;
  line: WebGLBuffer;
  lineCount: number;
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x3b6ea8;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: GL): { prog: WebGLProgram; pos: number; view: WebGLUniformLocation; proj: WebGLUniformLocation; color: WebGLUniformLocation } | null {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  return { prog, pos: gl.getAttribLocation(prog, 'a_pos'), view: gl.getUniformLocation(prog, 'u_view')!, proj: gl.getUniformLocation(prog, 'u_proj')!, color: gl.getUniformLocation(prog, 'u_color')! };
}

export class ZoningRenderer implements ICustomRenderer {
  readonly id = 'vtp-zoning';
  readonly renderPass = RenderPass.Opaque;
  /** Zoning fills and lines show; the parcel outline always does. */
  visible = true;
  private gl: GL | null = null;
  private program: ReturnType<typeof compile> = null;
  private meshes: Mesh[] = [];
  private parcelMesh: Mesh | null = null;
  private reference: LngLatAlt | null = null;
  private camera: { pos: Pos; alt: number } | null = null;
  private viewer: IViewer | null = null;
  private matrices: { view: number[]; proj: number[] } | null = null;

  constructor(
    private districts: District[],
    private parcel: Pos[] | null,
  ) {}

  onAdd(viewer: IViewer, reference: LngLatAlt, context: GL): void {
    this.viewer = viewer;
    this.gl = context;
    this.reference = reference;
    this.program = compile(context);
    this.rebuild();
  }

  onReference(_viewer: IViewer, reference: LngLatAlt): void {
    this.reference = reference;
    this.rebuild();
  }

  onRemove(_viewer: IViewer, context: GL): void {
    this.clear(context);
    if (this.program) context.deleteProgram(this.program.prog);
    this.program = null;
    this.gl = null;
    this.viewer = null;
  }

  /** The photo now shown: the ground is placed under it, and districts are picked around it. */
  setCamera(pos: Pos, alt: number): void {
    this.camera = { pos, alt };
    this.rebuild();
  }

  setParcel(ring: Pos[] | null): void {
    this.parcel = ring;
    this.rebuild();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.viewer?.triggerRerender();
  }

  private clear(gl: GL): void {
    for (const m of [...this.meshes, ...(this.parcelMesh ? [this.parcelMesh] : [])]) {
      gl.deleteBuffer(m.fill);
      gl.deleteBuffer(m.line);
    }
    this.meshes = [];
    this.parcelMesh = null;
  }

  private mesh(gl: GL, ring: Pos[], color: string, ground: number, fill: boolean): Mesh | null {
    const ref = this.reference!;
    const local = ringToLocal(ring, ref, ground, geodeticToEnu);
    const n = local.length / 3;
    if (n < 2) return null;
    const flat2: number[] = [];
    for (let i = 0; i < n; i++) flat2.push(local[i * 3], local[i * 3 + 1]);
    const tri = fill && n > 2 ? earcut(flat2) : [];
    const fillData = new Float32Array(tri.length * 3);
    tri.forEach((v, i) => fillData.set(local.slice(v * 3, v * 3 + 3), i * 3));
    // The boundary as a ribbon on the ground (WebGL lines are one pixel wide): two triangles a segment.
    const half = fill ? 0.22 : 0.15;
    const rib: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, ay, az] = local.slice(i * 3, i * 3 + 3);
      const [bx, by, bz] = local.slice(j * 3, j * 3 + 3);
      const len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const nx = (-(by - ay) / len) * half,
        ny = ((bx - ax) / len) * half;
      rib.push(ax + nx, ay + ny, az, ax - nx, ay - ny, az, bx + nx, by + ny, bz, bx + nx, by + ny, bz, ax - nx, ay - ny, az, bx - nx, by - ny, bz);
    }
    const lineData = new Float32Array(rib);
    const fb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, fillData, gl.STATIC_DRAW);
    const lb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, lb);
    gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
    return { color: rgb(color), fill: fb, fillCount: tri.length, line: lb, lineCount: rib.length / 3 };
  }

  private rebuild(): void {
    const gl = this.gl;
    if (!gl || !this.reference || !this.camera) return;
    this.clear(gl);
    const ground = this.camera.alt - CAMERA_HEIGHT_M;
    const cam = this.camera.pos;
    for (const d of this.districts)
      for (const ring of d.rings) {
        if (!ring.some((p) => distance(p, cam) < REACH_M) && !inRing(cam, ring)) continue;
        const m = this.mesh(gl, ring, d.color, ground, true);
        if (m) this.meshes.push(m);
      }
    if (this.parcel) this.parcelMesh = this.mesh(gl, this.parcel, '#ffffff', ground + 0.05, false);
    this.viewer?.triggerRerender();
  }

  /**
   * A ground point (at the pin's or a district's spot) in canvas pixels, or null when it is behind the camera
   * or the view is not drawn yet. Uses the last frame's matrices and the same ground height as the fills
   * (the viewer's own project() puts a point with no altitude at sea level, far below the street).
   */
  projectGround(at: Pos, width: number, height: number): [number, number] | null {
    const m = this.matrices;
    if (!m || !this.reference || !this.camera) return null;
    const [x, y, z] = geodeticToEnu(at[0], at[1], this.camera.alt - CAMERA_HEIGHT_M, this.reference.lng, this.reference.lat, this.reference.alt);
    const mul = (a: number[], v: number[]) => [0, 1, 2, 3].map((r) => a[r] * v[0] + a[4 + r] * v[1] + a[8 + r] * v[2] + a[12 + r] * v[3]);
    const c = mul(m.proj, mul(m.view, [x, y, z, 1]));
    if (c[3] <= 0) return null;
    return [((c[0] / c[3] + 1) / 2) * width, ((1 - c[1] / c[3]) / 2) * height];
  }

  render(gl: GL, viewMatrix: number[], projectionMatrix: number[]): void {
    this.matrices = { view: viewMatrix, proj: projectionMatrix };
    const p = this.program;
    if (!p || (!this.meshes.length && !this.parcelMesh)) return;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.view, false, viewMatrix);
    gl.uniformMatrix4fv(p.proj, false, projectionMatrix);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enableVertexAttribArray(p.pos);
    const draw = (buf: WebGLBuffer, mode: number, count: number, c: [number, number, number], a: number) => {
      if (!count) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.vertexAttribPointer(p.pos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(p.color, c[0], c[1], c[2], a);
      gl.drawArrays(mode, 0, count);
    };
    if (this.visible)
      for (const m of this.meshes) {
        draw(m.fill, gl.TRIANGLES, m.fillCount, m.color, 0.12);
        draw(m.line, gl.TRIANGLES, m.lineCount, m.color, 0.85);
      }
    if (this.parcelMesh) draw(this.parcelMesh.line, gl.TRIANGLES, this.parcelMesh.lineCount, [1, 1, 1], 0.95);
    gl.disableVertexAttribArray(p.pos);
  }
}

function inRing(p: Pos, r: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  }
  return inside;
}

export { inRing };
