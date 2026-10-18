import React, { useMemo, useState } from 'react';
import LineChart from './LineChart.js';

const SWEEP_COLORS = ['var(--cell)', 'var(--phosphorylated)', 'var(--text)', 'var(--cartilage)', 'var(--adventitia)'];

export default function StiffnessCurveChart({ data, activationSeries }) {
  const [view, setView] = useState('stiffness');
  const singleSeries = useMemo(() => [{ label: 'Lumen narrowing', color: 'var(--cell)', points: data }], [data]);
  const multiSeries = useMemo(() => {
    if (!activationSeries?.length) return null;
    return activationSeries.map((entry, idx) => ({
      label: `${entry.multiplier}×`,
      color: SWEEP_COLORS[idx % SWEEP_COLORS.length],
      points: entry.points,
    }));
  }, [activationSeries]);

  return (
    <>
      {multiSeries && (
        <div className="chart-toolbar">
          <h2>Stiffness and lumen narrowing</h2>
          <label htmlFor="sweep-chart-view" className="sr-only">Sweep view</label>
          <select id="sweep-chart-view" value={view} onChange={e => setView(e.target.value)}>
            <option value="stiffness">Against non-muscle stiffness</option>
            <option value="activation">Against activation (0.25×–4×)</option>
          </select>
        </div>
      )}
      {view === 'activation' && multiSeries ? (
        <LineChart
          title="Narrowing against activation"
          series={multiSeries}
          xLabel="Activation"
          yLabel="Lumen narrowing (%)"
          xTicks={[0, .25, .5, .75, 1]}
          showTitle={false}
        />
      ) : (
        <LineChart
          title="Stiffness and lumen narrowing"
          series={singleSeries}
          xLabel="Non-muscle modulus multiplier"
          yLabel="Lumen narrowing (%)"
          xTicks={[.25, .5, 1, 2, 4]}
          showTitle={!multiSeries}
        />
      )}
    </>
  );
}
