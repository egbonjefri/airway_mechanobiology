import React, { useMemo } from 'react';

const W = 560, H = 290;
const P = { left: 62, right: 18, top: 15, bottom: 52 };
const niceStep = rough => {
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  return [1, 2, 2.5, 5, 10].find(n => n * power >= rough) * power;
};
const format = value => Number(value.toPrecision(3)).toString();

export default function LineChart({ title, series, xLabel, yLabel, xTicks, cursor, yLimit, description, showTitle = true }) {
  const layout = useMemo(() => {
    const points = series.flatMap(s => s.points);
    const xs = points.map(p => p.x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const peak = Math.max(0, ...points.map(p => p.y));
    const step = niceStep((yLimit || peak || 1) / 4);
    const yMax = yLimit || Math.ceil((peak || 1) / step) * step;
    const x = v => P.left + (v - xMin) / (xMax - xMin || 1) * (W - P.left - P.right);
    const y = v => H - P.bottom - v / yMax * (H - P.top - P.bottom);
    return { x, y, yMax, step, paths: series.map(s => s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`).join(' ')),
      xTicks: xTicks || Array.from({ length: 5 }, (_, i) => xMin + (xMax - xMin) * i / 4) };
  }, [series, xTicks, yLimit]);
  return (
    <figure className="line-chart">
      {showTitle && <figcaption>{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${description || `${yLabel} versus ${xLabel}`}`}>
        {Array.from({ length: Math.floor(layout.yMax / layout.step) + 1 }, (_, i) => i * layout.step).map(value => (
          <g key={value}>
            <line x1={P.left} x2={W - P.right} y1={layout.y(value)} y2={layout.y(value)} className="chart-grid" />
            <text x={P.left - 10} y={layout.y(value) + 4} textAnchor="end" className="chart-tick">{format(value)}</text>
          </g>
        ))}
        {layout.xTicks.map(value => <text key={value} x={layout.x(value)} y={H - P.bottom + 23} textAnchor="middle" className="chart-tick">{format(value)}</text>)}
        {series.map((s, i) => <path key={s.label} d={layout.paths[i]} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '6 4' : undefined} />)}
        {cursor !== undefined && <line x1={layout.x(cursor)} x2={layout.x(cursor)} y1={P.top} y2={H - P.bottom} className="chart-cursor" />}
        <text x={(W + P.left - P.right) / 2} y={H - 6} textAnchor="middle" className="chart-label">{xLabel}</text>
        <text transform={`translate(17 ${(H + P.top - P.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="chart-label">{yLabel}</text>
      </svg>
      {series.length > 1 && <ul className="chart-legend">{series.map(s => <li key={s.label}><span style={{ background: s.color }} aria-hidden="true" />{s.label}</li>)}</ul>}
    </figure>
  );
}
