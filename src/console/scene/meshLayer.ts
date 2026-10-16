/**
 * A MapLibre custom 3D layer that draws a static mesh of shaded triangles (interleaved x, y, z, r, g, b: local
 * meters from an origin, colours already lit) with plain WebGL: the buildings, roads and signs of the street
 * scene. One buffer; a new mesh replaces it. Positions stay in meters around an origin on the ground, so the
 * GPU keeps its precision close up.
 */
import * as maplibregl from 'maplibre-gl';

export interface MeshData {
  /** Longitude, latitude and ground height (meters above sea level) of the local origin. */
  origin: [number, number, number];
  data: Float32Array;
}

const VERT = `attribute vec3 a_pos; attribute vec3 a_col; uniform mat4 u_m; varying vec3 v_col;
void main() { v_col = a_col; gl_Position = u_m * vec4(a_pos, 1.0); }`;
const FRAG = `precision mediump float; varying vec3 v_col; void main() { gl_FragColor = vec4(v_col, 1.0); }`;

export interface MeshLayer extends maplibregl.CustomLayerInterface {
  setMesh(m: MeshData | null): void;
  /** The mesh now drawn, if any. */
  readonly mesh: MeshData | null;
}

/** Column-major 4x4 product a * b. */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

export function meshLayer(id: string): MeshLayer {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let prog: WebGLProgram | null = null;
  let buf: WebGLBuffer | null = null;
  let count = 0;
  let mesh: MeshData | null = null;
  let dirty = false;
  let map: maplibregl.Map | null = null;
  const upload = () => {
    if (!gl || !buf) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh ? mesh.data : new Float32Array(0), gl.STATIC_DRAW);
    count = mesh ? mesh.data.length / 6 : 0;
    dirty = false;
  };
  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    get mesh() {
      return mesh;
    },
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
      if (!prog || !buf || !mesh) return;
      if (dirty) upload();
      if (!count) return;
      const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: mesh.origin[0], lat: mesh.origin[1] }, mesh.origin[2]);
      const s = mc.meterInMercatorCoordinateUnits();
      // Meters east, north and up to map units (y flipped: north is up on the map, down in mercator).
      const model = new Float32Array([s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, mc.x, mc.y, mc.z, 1]);
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
      context.enable(context.CULL_FACE);
      context.cullFace(context.BACK);
      context.drawArrays(context.TRIANGLES, 0, count);
      context.disable(context.CULL_FACE);
      context.disableVertexAttribArray(pos);
      context.disableVertexAttribArray(col);
    },
    setMesh(m) {
      mesh = m;
      dirty = true;
      map?.triggerRepaint();
    },
  };
}
