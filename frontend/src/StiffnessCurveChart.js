import React, { useRef, useEffect } from 'react';
import { FONT_FAMILY, setupCanvas, useThemeColors } from './theme';

const WIDTH = 640;
const HEIGHT = 360;
const PADDING = { top: 12, right: 16, bottom: 56, left: 64 };

// Round a tick step up to 1, 2, 2.5 or 5 times a power of ten
const niceStep = (rough) => {
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
};

// Fewest decimals that show a tick step exactly
const decimalsFor = (step) =>
  [0, 1, 2, 3].find(d => Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) ?? 3;

const StiffnessCurveChart = ({ data = [] }) => {
  const canvasRef = useRef(null);
  const colors = useThemeColors();

  useEffect(() => {
    if (!data || data.length === 0) return;

    const ctx = setupCanvas(canvasRef.current, WIDTH, HEIGHT);
    const chartWidth = WIDTH - PADDING.left - PADDING.right;
    const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const bottom = PADDING.top + chartHeight;

    const xValues = data.map(d => d.x);
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yPeak = Math.max(...data.map(d => d.y));
    const yStep = yPeak > 0 ? niceStep(yPeak / 5) : 0.2;
    const yMax = yPeak > 0 ? Math.ceil(yPeak / yStep) * yStep : 1;

    const scaleX = (x) => PADDING.left + ((x - xMin) / (xMax - xMin || 1)) * chartWidth;
    const scaleY = (y) => bottom - (y / yMax) * chartHeight;

    ctx.font = `14px ${FONT_FAMILY}`;
    ctx.fillStyle = colors.muted;

    // Horizontal grid lines and y labels
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const decimals = decimalsFor(yStep);
    for (let y = 0; y <= yMax + yStep / 2; y += yStep) {
      const py = Math.round(scaleY(y)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PADDING.left, py);
      ctx.lineTo(PADDING.left + chartWidth, py);
      ctx.stroke();
      ctx.fillText(y.toFixed(decimals), PADDING.left - 10, py);
    }

    // x labels at each stiffness that was run
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const x of xValues) {
      ctx.fillText(String(x), scaleX(x), bottom + 10);
    }

    // Axis titles
    ctx.fillStyle = colors.text;
    ctx.font = `15px ${FONT_FAMILY}`;
    ctx.textBaseline = 'bottom';
    ctx.fillText('Stiffness (k)', PADDING.left + chartWidth / 2, HEIGHT - 4);

    ctx.save();
    ctx.translate(18, PADDING.top + chartHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Lumen constriction (%)', 0, 0);
    ctx.restore();

    // Data line and points
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((point, idx) => {
      const x = scaleX(point.x);
      const y = scaleY(point.y);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = colors.text;
    for (const point of data) {
      ctx.beginPath();
      ctx.arc(scaleX(point.x), scaleY(point.y), 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }, [data, colors]);

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label="Line chart of steady-state lumen constriction against stiffness"
    />
  );
};

export default StiffnessCurveChart;
