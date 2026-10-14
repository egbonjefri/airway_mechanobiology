import React, { useRef, useEffect } from 'react';
import { FONT_FAMILY, setupCanvas, useThemeColors } from './theme.js';
import { displayRadii } from './deformation.js';

const SIZE = 520;
const TAU = 2 * Math.PI;
const tint = (hex, opacity) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${opacity})`;
const polar = (radius, angle) => [radius * Math.cos(angle), radius * Math.sin(angle)];

function tissueTexture(ctx, layer, inner, outer, referenceInner, referenceOuter, color, background) {
  // Fixed seeds attach the illustrative texture to the same material positions
  // on every frame. Texture never changes the solved layer boundaries.
  let seed = 419 + layer * 119;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const thickness = outer - inner;
  const radialStretch = thickness / (referenceOuter - referenceInner);
  const at = (fraction, angle) => polar(inner + fraction * thickness, angle);
  ctx.lineCap = 'round';

  if (layer === 0 || layer === 3) {
    // Loose connective fibres in the mucosa and adventitia.
    ctx.strokeStyle = tint(color, .42);
    ctx.lineWidth = .8;
    for (let i = 0; i < 95; i++) {
      const fraction = .12 + .78 * random(), angle = TAU * random();
      const length = .035 + .10 * random();
      ctx.beginPath(); ctx.moveTo(...at(fraction, angle - length));
      ctx.bezierCurveTo(...at(fraction + .15, angle - length / 3),
        ...at(fraction - .15, angle + length / 3), ...at(fraction, angle + length));
      ctx.stroke();
    }
  }

  if (layer === 0) {
    // A fine cellular lining gives the lumen edge a tissue appearance.
    const depth = Math.min(5 * radialStretch, thickness * .32);
    for (let i = 0; i < 72; i++) {
      const angle = i * TAU / 72, radius = inner + depth + .7;
      ctx.save(); ctx.translate(...polar(radius, angle)); ctx.rotate(angle + Math.PI / 2);
      ctx.beginPath(); ctx.ellipse(0, 0, radius * Math.PI / 72 * .83, depth, 0, 0, TAU);
      ctx.fillStyle = tint(color, .34); ctx.fill();
      ctx.strokeStyle = tint(color, .55); ctx.lineWidth = .65; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, depth * .25, 1.1, 1.7, 0, 0, TAU);
      ctx.fillStyle = tint(color, .85); ctx.fill(); ctx.restore();
    }
  }

  if (layer === 1) {
    // Three staggered rows of circumferential, spindle-shaped muscle fibres.
    for (let row = 0; row < 3; row++) for (let i = 0; i < 27; i++) {
      const fraction = .19 + row * .31;
      const angle = (i + row * .37) * TAU / 27;
      const radius = inner + fraction * thickness;
      const halfLength = radius * Math.PI / 27 * (.83 + .08 * random());
      const halfWidth = thickness * .10;
      ctx.save(); ctx.translate(...polar(radius, angle)); ctx.rotate(angle + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(-halfLength, 0);
      ctx.quadraticCurveTo(0, -2 * halfWidth, halfLength, 0);
      ctx.quadraticCurveTo(0, 2 * halfWidth, -halfLength, 0);
      ctx.fillStyle = tint(color, .28 + .15 * random()); ctx.fill();
      ctx.strokeStyle = tint(color, .65); ctx.lineWidth = .65; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, halfLength * .24, Math.max(.7, halfWidth * .24), 0, 0, TAU);
      ctx.fillStyle = tint(color, .9); ctx.fill(); ctx.restore();
    }
  }

  if (layer === 2) {
    // Cartilage cells and their surrounding spaces, staggered through the matrix.
    for (let row = 0; row < 2; row++) for (let i = 0; i < 40; i++) {
      const fraction = .27 + row * .44 + (random() - .5) * .15;
      const angle = (i + row * .5 + random() * .28) * TAU / 40;
      const tangentialStretch = (inner + fraction * thickness) / (referenceInner + fraction * (referenceOuter - referenceInner));
      ctx.save(); ctx.translate(...at(fraction, angle)); ctx.rotate(angle + .4 * random());
      ctx.beginPath(); ctx.ellipse(0, 0, (2.7 + random()) * radialStretch, (3.6 + random()) * tangentialStretch, 0, 0, TAU);
      ctx.fillStyle = tint(background, .65); ctx.fill();
      ctx.strokeStyle = tint(color, .5); ctx.lineWidth = .9; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-.3, .4, 1.3 * radialStretch, 1.7 * tangentialStretch, 0, 0, TAU);
      ctx.fillStyle = tint(color, .75); ctx.fill(); ctx.restore();
    }
  }
}

const GridVisualizer = ({ radii, referenceRadii, sectors = 80, narrowing = null, showMesh = false, magnification = 1 }) => {
  const canvasRef = useRef(null);
  const colors = useThemeColors();
  useEffect(() => {
    if (!radii?.length) return;
    const ctx = setupCanvas(canvasRef.current, SIZE, SIZE);
    const center = SIZE / 2;
    const scale = (SIZE / 2 - 24) / referenceRadii.at(-1);
    const displayed = displayRadii(referenceRadii, radii, magnification);
    ctx.translate(center, center);
    const point = (r, sector) => polar(scale * r, TAU * sector / sectors);
    const ring = (r, reverse = false) => {
      for (let i = 0; i <= sectors; i++) {
        const p = point(r, reverse ? -i : i);
        if (!i) ctx.moveTo(...p); else ctx.lineTo(...p);
      }
      ctx.closePath();
    };
    const indices = [0, .2, .5, .8, 1].map(f => Math.round(f * (radii.length - 1)));

    ctx.save();
    ctx.beginPath(); ring(displayed.at(-1)); ring(displayed[0], true);
    ctx.shadowColor = tint(colors.text, .10); ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
    ctx.fillStyle = colors.background; ctx.fill('evenodd'); ctx.restore();

    [colors.mucosa, colors.muscle, colors.cartilage, colors.adventitia].forEach((color, i) => {
      const inner = displayed[indices[i]], outer = displayed[indices[i + 1]];
      ctx.save(); ctx.beginPath(); ring(outer); ring(inner, true); ctx.clip('evenodd');
      const gradient = ctx.createRadialGradient(0, 0, scale * inner, 0, 0, scale * outer);
      gradient.addColorStop(0, tint(color, .38)); gradient.addColorStop(.45, tint(color, .24)); gradient.addColorStop(1, tint(color, .40));
      ctx.fillStyle = gradient; ctx.fillRect(-center, -center, SIZE, SIZE);
      tissueTexture(ctx, i, inner * scale, outer * scale,
        referenceRadii[indices[i]] * scale, referenceRadii[indices[i + 1]] * scale, color, colors.background);
      ctx.restore();
    });
    if (showMesh) {
      // Q1 element edges; display only, independent of the solver mesh.
      ctx.strokeStyle = colors.node; ctx.lineWidth = .55; ctx.globalAlpha = .45;
      ctx.beginPath(); displayed.forEach(r => ring(r));
      for (let i = 0; i < sectors; i++) { ctx.moveTo(...point(displayed[0], i)); ctx.lineTo(...point(displayed.at(-1), i)); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // A narrow halo keeps the reference contour legible over tissue detail.
    ctx.setLineDash([5, 5]); ctx.beginPath(); ring(referenceRadii[0]);
    ctx.strokeStyle = colors.background; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = colors.text; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = tint(colors.text, .75); ctx.lineWidth = 1.2;
    ctx.beginPath(); ring(displayed[0]); ring(displayed.at(-1)); ctx.stroke();
    const labelScale = Math.min(1, displayed[0] / referenceRadii[0] / .6);
    ctx.scale(labelScale, labelScale);
    ctx.fillStyle = colors.muted; ctx.textAlign = 'center'; ctx.font = `18px ${FONT_FAMILY}`;
    ctx.fillText('Lumen', 0, -12);
    ctx.fillStyle = colors.text; ctx.font = `28px ${FONT_FAMILY}`;
    ctx.fillText(narrowing === null ? 'At rest' : `${narrowing.toFixed(3)}%`, 0, 22);
    if (narrowing !== null) { ctx.font = `15px ${FONT_FAMILY}`; ctx.fillStyle = colors.muted; ctx.fillText('actual area reduction', 0, 45); }
  }, [radii, referenceRadii, sectors, narrowing, colors, showMesh, magnification]);
  return <canvas ref={canvasRef} width={SIZE} height={SIZE} role="img"
    aria-label={`Airway cross-section with illustrative tissue textures, fixed outer boundary, radial deformation scale ${magnification} times${narrowing === null ? ', at rest' : `, actual lumen narrowing ${narrowing.toFixed(3)} percent`}`} />;
};
export default GridVisualizer;
