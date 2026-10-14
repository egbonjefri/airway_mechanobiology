import React, { useRef, useEffect } from 'react';
import { setupCanvas, useThemeColors } from './theme';

const SIZE = 520;

const GridVisualizer = ({
  positions = [],
  springs = [],
  cells = [],
  fixedIndices = [],
  numCircum = 24
}) => {
  const canvasRef = useRef(null);
  const colors = useThemeColors();

  useEffect(() => {
    if (!positions || positions.length === 0) return;

    const ctx = setupCanvas(canvasRef.current, SIZE, SIZE);
    const center = SIZE / 2;

    // Fit the outermost ring to the canvas, leaving room for the node dots
    const maxRadius = Math.max(...positions.map(([x, y]) => Math.hypot(x, y)));
    const scale = (SIZE / 2 - 8) / maxRadius;
    const toCanvas = ([x, y]) => [center + x * scale, center + y * scale];

    // Springs
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const spring of springs) {
      const p1 = positions[spring.m1];
      const p2 = positions[spring.m2];
      if (!p1 || !p2) continue;
      ctx.moveTo(...toCanvas(p1));
      ctx.lineTo(...toCanvas(p2));
    }
    ctx.stroke();

    // Lumen boundary: the innermost ring
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let c = 0; c < numCircum; c++) {
      const [x, y] = toCanvas(positions[c]);
      if (c === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // Masses: muscle cells, the fixed outer ring, and free tissue
    const cellIndices = new Set(cells.map(c => c.mass_idx));
    const fixedSet = new Set(fixedIndices);
    positions.forEach((pos, idx) => {
      let color = colors.node;
      let radius = 2.5;
      if (cellIndices.has(idx)) {
        color = colors.cell;
        radius = 4;
      } else if (fixedSet.has(idx)) {
        color = colors.text;
        radius = 3;
      }

      const [x, y] = toCanvas(pos);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [positions, springs, cells, fixedIndices, numCircum, colors]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{ maxWidth: SIZE }}
      role="img"
      aria-label="Cross-section of the airway wall as a mass-spring mesh"
    />
  );
};

export default GridVisualizer;
