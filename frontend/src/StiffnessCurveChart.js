import React, { useMemo } from 'react';
import LineChart from './LineChart.js';

export default function StiffnessCurveChart({ data }) {
  const series = useMemo(() => [{ label: 'Lumen narrowing', color: 'var(--cell)', points: data }], [data]);
  return <LineChart title="Stiffness and lumen narrowing" series={series}
    xLabel="Non-muscle modulus multiplier" yLabel="Lumen narrowing (%)" xTicks={[.25, .5, 1, 2, 4]} />;
}
