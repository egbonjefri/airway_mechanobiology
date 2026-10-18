import React, { useRef, useEffect } from 'react';
import { FONT_FAMILY, setupCanvas, useThemeColors } from './theme.js';
import { displayRadii } from './deformation.js';
import { TEXTURE_SIZE, paintSection, sectionScale } from './histology.js';

const SIZE = 520;
const TAU = 2 * Math.PI;
const SEGMENTS = 360;
const polar = (radius, angle) => [radius * Math.cos(angle), radius * Math.sin(angle)];

// The painted section depends only on the resting geometry, so paint it once.
const sections = new Map();
function sectionFor(innerRadius, outerRadius) {
  const key = `${innerRadius}:${outerRadius}`;
  if (!sections.has(key)) sections.set(key, paintSection({ innerRadius, outerRadius }));
  return sections.get(key);
}

const VERTEX = `attribute vec2 position; attribute vec2 texel; uniform float size; varying vec2 vTexel;
void main() { vTexel = texel; gl_Position = vec4(position.x / size * 2.0 - 1.0, 1.0 - position.y / size * 2.0, 0.0, 1.0); }`;
const FRAGMENT = `precision mediump float; uniform sampler2D section; varying vec2 vTexel;
void main() { gl_FragColor = texture2D(section, vTexel); }`;

// Each mesh vertex sits at its displayed radius and samples the section at its
// resting radius, so the tissue stretches exactly as the solved wall does:
// linearly between nodes radially, with the angle unchanged.
function createWarp() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const program = gl.createProgram();
  [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]].forEach(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader);
  });
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  const attribute = name => {
    const buffer = gl.createBuffer(), location = gl.getAttribLocation(program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    return buffer;
  };
  const positions = attribute('position'), texels = attribute('texel');
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.uniform1f(gl.getUniformLocation(program, 'size'), SIZE);
  let uploaded = null, mesh = '', indexCount = 0;
  const grid = (radii, place) => {
    const values = new Float32Array(radii.length * (SEGMENTS + 1) * 2);
    radii.forEach((radius, i) => { for (let j = 0; j <= SEGMENTS; j++) values.set(place(radius, TAU * j / SEGMENTS), 2 * (i * (SEGMENTS + 1) + j)); });
    return values;
  };

  return {
    canvas,
    draw(section, reference, displayed, scale) {
      const pixels = Math.round(SIZE * (window.devicePixelRatio || 1));
      if (canvas.width !== pixels) canvas.width = canvas.height = pixels;
      if (uploaded !== section) {
        uploaded = section;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, section);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      const key = reference.join();
      if (mesh !== key) {
        mesh = key;
        const textureScale = sectionScale(reference.at(-1));
        gl.bindBuffer(gl.ARRAY_BUFFER, texels);
        gl.bufferData(gl.ARRAY_BUFFER, grid(reference, (radius, angle) =>
          polar(textureScale * radius, angle).map(v => .5 + v / TEXTURE_SIZE)), gl.STATIC_DRAW);
        const order = [];
        for (let i = 0; i + 1 < reference.length; i++) for (let j = 0; j < SEGMENTS; j++) {
          const a = i * (SEGMENTS + 1) + j, b = a + SEGMENTS + 1;
          order.push(a, b, a + 1, a + 1, b, b + 1);
        }
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(order), gl.STATIC_DRAW);
        indexCount = order.length;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, positions);
      gl.bufferData(gl.ARRAY_BUFFER, grid(displayed, (radius, angle) =>
        polar(scale * radius, angle).map(v => SIZE / 2 + v)), gl.DYNAMIC_DRAW);
      gl.viewport(0, 0, pixels, pixels);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    },
  };
}

// Every cross-section on the page draws through one context and texture,
// copying the result out immediately after rendering.
let warp;
const sharedWarp = () => (warp === undefined ? warp = createWarp() : warp);

const GridVisualizer = ({ radii, referenceRadii, sectors = 80, narrowing = null, showMesh = false, magnification = 1 }) => {
  const canvasRef = useRef(null);
  const colors = useThemeColors();
  useEffect(() => {
    if (!radii?.length) return;
    const ctx = setupCanvas(canvasRef.current, SIZE, SIZE);
    const center = SIZE / 2;
    const scale = (SIZE / 2 - 24) / referenceRadii.at(-1);
    const displayed = displayRadii(referenceRadii, radii, magnification);
    const section = sectionFor(referenceRadii[0], referenceRadii.at(-1));
    if (sharedWarp()) {
      warp.draw(section, referenceRadii, displayed, scale);
      ctx.drawImage(warp.canvas, 0, 0, SIZE, SIZE);
      ctx.translate(center, center);
    } else {
      // Without WebGL, scale the section about the centre one element at a time.
      ctx.translate(center, center);
      const textureScale = sectionScale(referenceRadii.at(-1));
      ctx.imageSmoothingQuality = 'high';
      displayed.slice(1).forEach((outer, i) => {
        const inner = displayed[i], stretch = (inner + outer) / (referenceRadii[i] + referenceRadii[i + 1]);
        const size = TEXTURE_SIZE * scale * stretch / textureScale;
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, scale * outer, 0, TAU); ctx.arc(0, 0, scale * inner, 0, TAU, true); ctx.clip('evenodd');
        ctx.drawImage(section, -size / 2, -size / 2, size, size); ctx.restore();
      });
    }

    const point = (r, sector) => polar(scale * r, TAU * sector / sectors);
    const ring = r => {
      for (let i = 0; i <= sectors; i++) {
        const p = point(r, i);
        if (!i) ctx.moveTo(...p); else ctx.lineTo(...p);
      }
      ctx.closePath();
    };
    if (showMesh) {
      // Q1 element edges; display only, independent of the solver mesh.
      ctx.strokeStyle = colors.text; ctx.lineWidth = .5; ctx.globalAlpha = .35;
      ctx.beginPath(); displayed.forEach(r => ring(r));
      for (let i = 0; i < sectors; i++) { ctx.moveTo(...point(displayed[0], i)); ctx.lineTo(...point(displayed.at(-1), i)); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // A narrow halo keeps the reference contour legible over tissue detail.
    ctx.setLineDash([5, 5]); ctx.beginPath(); ring(referenceRadii[0]);
    ctx.strokeStyle = colors.background; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = colors.text; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
    const labelScale = Math.min(1, displayed[0] / referenceRadii[0] / .6);
    ctx.scale(labelScale, labelScale);
    ctx.fillStyle = colors.muted; ctx.textAlign = 'center'; ctx.font = `18px ${FONT_FAMILY}`;
    ctx.fillText('Lumen', 0, -12);
    ctx.fillStyle = colors.text; ctx.font = `28px ${FONT_FAMILY}`;
    ctx.fillText(narrowing === null ? 'At rest' : `${narrowing.toFixed(3)}%`, 0, 22);
    if (narrowing !== null) { ctx.font = `15px ${FONT_FAMILY}`; ctx.fillStyle = colors.muted; ctx.fillText('actual area reduction', 0, 45); }
  }, [radii, referenceRadii, sectors, narrowing, colors, showMesh, magnification]);
  return <canvas ref={canvasRef} width={SIZE} height={SIZE} role="img"
    aria-label={`Airway cross-section with an illustrative stained-tissue texture, fixed outer boundary, radial deformation scale ${magnification} times${narrowing === null ? ', at rest' : `, actual lumen narrowing ${narrowing.toFixed(3)} percent`}`} />;
};
export default GridVisualizer;
