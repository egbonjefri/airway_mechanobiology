import React, { useMemo, useRef, useState } from 'react';

const W = 560, H = 290;
const P = { left: 62, right: 18, top: 15, bottom: 52 };
const niceStep = rough => {
  const safe = Math.abs(rough) || 1;
  const power = 10 ** Math.floor(Math.log10(safe));
  return ([1, 2, 2.5, 5, 10].find(n => n * power >= safe) || 10) * power;
};
const format = value => Number(value.toPrecision(3)).toString();

export default function LineChart({
  title, series, xLabel, yLabel, xTicks, cursor, yLimit, markers = [], onScrub, description, showTitle = true,
}) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const layout = useMemo(() => {
    const points = series.flatMap(s => s.points);
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const rawMin = Math.min(0, ...ys), rawMax = Math.max(0, ...ys);
    const span = yLimit || (rawMax - rawMin) || 1;
    const step = niceStep(span / 4);
    const yMin = rawMin < 0 ? Math.floor(rawMin / step) * step : 0;
    let yMax = yLimit || Math.ceil((rawMax || (yMin === 0 ? 1 : 0)) / step) * step;
    if (yMax === yMin) yMax = yMin + step;
    const x = v => P.left + (v - xMin) / (xMax - xMin || 1) * (W - P.left - P.right);
    const y = v => H - P.bottom - (v - yMin) / (yMax - yMin || 1) * (H - P.top - P.bottom);
    const yTicks = [];
    for (let val = yMin; val <= yMax + 1e-9 * step; val += step) {
      yTicks.push(Math.abs(val) < 1e-12 ? 0 : val);
    }
    return {
      x, y, xMin, xMax, yMin, yMax, step, yTicks,
      paths: series.map(s => s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`).join(' ')),
      xTicks: xTicks || Array.from({ length: 5 }, (_, i) => xMin + (xMax - xMin) * i / 4),
    };
  }, [series, xTicks, yLimit]);

  const xFromEvent = event => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) / (rect.width || 1) * W;
    const clamped = Math.max(P.left, Math.min(W - P.right, svgX));
    return layout.xMin + (clamped - P.left) / (W - P.left - P.right) * (layout.xMax - layout.xMin);
  };

  return (
    <figure className="line-chart">
      {showTitle && <figcaption>{title}</figcaption>}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}. ${description || `${yLabel} versus ${xLabel}`}`}
        style={onScrub ? { cursor: 'ew-resize' } : undefined}
        onPointerDown={event => {
          if (!onScrub) return;
          const val = xFromEvent(event);
          if (val !== null) { setDragging(true); onScrub(val); }
        }}
        onPointerMove={event => {
          if (dragging && onScrub) {
            const val = xFromEvent(event);
            if (val !== null) onScrub(val);
          }
        }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        {markers.map(m => (
          <line key={m.x} x1={layout.x(m.x)} x2={layout.x(m.x)} y1={P.top} y2={H - P.bottom} className="chart-marker" />
        ))}
        {layout.yMin < 0 && layout.yMax > 0 && (
          <line x1={P.left} x2={W - P.right} y1={layout.y(0)} y2={layout.y(0)} className="chart-zero" />
        )}
        {layout.yTicks.map(value => (
          <g key={value}>
            <line x1={P.left} x2={P.left + 6} y1={layout.y(value)} y2={layout.y(value)} className="chart-axis" />
            <text x={P.left - 10} y={layout.y(value) + 4} textAnchor="end" className="chart-tick">{format(value)}</text>
          </g>
        ))}
        {layout.xTicks.map(value => <g key={value}>
          <line x1={layout.x(value)} x2={layout.x(value)} y1={H - P.bottom} y2={H - P.bottom - 6} className="chart-axis" />
          <text x={layout.x(value)} y={H - P.bottom + 23} textAnchor="middle" className="chart-tick">{format(value)}</text>
        </g>)}
        {series.map((s, i) => (
          <path key={s.label} d={layout.paths[i]} fill="none" stroke={s.color}
            strokeWidth={s.muted ? '1.5' : '2'} strokeOpacity={s.muted ? '0.65' : '1'}
            strokeDasharray={s.dashed ? '6 4' : undefined} />
        ))}
        <rect x={P.left} y={P.top} width={W - P.left - P.right} height={H - P.top - P.bottom} fill="transparent" className="chart-axis" />
        {cursor !== undefined && cursor !== null && (
          <line x1={layout.x(cursor)} x2={layout.x(cursor)} y1={P.top} y2={H - P.bottom} className="chart-cursor" />
        )}
        <text x={(W + P.left - P.right) / 2} y={H - 6} textAnchor="middle" className="chart-label">{xLabel}</text>
        <text transform={`translate(17 ${(H + P.top - P.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="chart-label">{yLabel}</text>
      </svg>
      {series.length > 1 && <ul className="chart-legend">{series.map(s => <li key={s.label}><span style={{ background: s.color, opacity: s.muted ? .65 : 1 }} aria-hidden="true" />{s.label}</li>)}</ul>}
    </figure>
  );
}
