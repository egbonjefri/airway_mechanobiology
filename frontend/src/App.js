import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import GridVisualizer from './GridVisualizer.js';
import StiffnessCurveChart from './StiffnessCurveChart.js';
import LineChart from './LineChart.js';
import { DEFAULT_PARAMS } from './simulation.js';
import { deformationScale } from './deformation.js';
import { STAIN } from './histology.js';
import './index.css';

const REPOSITORY = 'https://github.com/egbonjefri/airway_mechanobiology';
const freshParameters = () => ({ ...DEFAULT_PARAMS, moduli: { ...DEFAULT_PARAMS.moduli } });
const formatNumber = value => Number(value.toFixed(3)).toString();
const LAYERS = [
  { key: 'mucosa', label: 'Mucosa / submucosa', base: 25 },
  { key: 'muscle', label: 'Smooth muscle', base: 50 },
  { key: 'cartilage', label: 'Cartilage', base: 150 },
  { key: 'adventitia', label: 'Adventitia', base: 75 },
];
const WALL_MARKERS = [{ x: 1.2 }, { x: 1.5 }, { x: 1.8 }];

function Slider({ id, label, value, min, max, step, format = formatNumber, onChange }) {
  return <div className="control">
    <label htmlFor={id}>{label}</label><output htmlFor={id}>{format(value)}</output>
    <input id={id} type="range" min={min} max={max} step={step} value={value}
      onChange={event => onChange(Number(event.target.value))} />
  </div>;
}

function frameAtTime(frames, time) {
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].time <= time) low = middle; else high = middle - 1;
  }
  return low;
}

function App() {
  const [parameters, setParameters] = useState(freshParameters);
  const [mode, setMode] = useState('kinetic');
  const [simulation, setSimulation] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [curve, setCurve] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(0);
  const [speed, setSpeed] = useState(10);
  const [showMesh, setShowMesh] = useState(false);
  const [trueScale, setTrueScale] = useState(false);
  const [plot, setPlot] = useState('narrowing');
  const [task, setTask] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const workerRef = useRef(null);
  const runId = useRef(0);
  const frameRef = useRef(0);
  const comparisonRef = useRef(null);
  frameRef.current = currentFrame;
  const busy = task !== null;

  useEffect(() => () => workerRef.current?.terminate(), []);

  // The comparison appears below the controls, so bring it into view when it is ready.
  useEffect(() => {
    if (!curve) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    comparisonRef.current?.scrollIntoView({ behavior: motion, block: 'nearest' });
  }, [curve]);

  useEffect(() => {
    if (!playing || simulation?.mode !== 'kinetic') return undefined;
    let handle, start;
    const initialTime = simulation.frames[frameRef.current].time;
    const endTime = simulation.frames.at(-1).time;
    const tick = timestamp => {
      if (start === undefined) start = timestamp;
      const time = Math.min(endTime, initialTime + (timestamp - start) * speed / 1000);
      setClock(time); setCurrentFrame(frameAtTime(simulation.frames, time));
      if (time >= endTime) setPlaying(false); else handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, simulation, speed]);

  const clearResults = () => {
    setSimulation(null); setCurve(null); setPlaying(false); setCurrentFrame(0); setError(''); setNotice('');
  };
  const change = (key, value) => {
    setParameters(previous => ({ ...previous, [key]: value })); clearResults();
  };
  const changeLayer = (key, value) => {
    setParameters(previous => ({ ...previous, moduli: { ...previous.moduli, [key]: value } })); clearResults();
  };
  const selectMode = next => {
    setMode(next);
    if (next === 'prescribed' && ['narrowing', 'tension', 'states', 'input'].includes(plot)) {
      setPlot('displacement');
    } else if (next === 'kinetic' && ['displacement', 'stretch', 'stress'].includes(plot)) {
      setPlot('narrowing');
    }
    clearResults();
  };
  const restoreDefaults = () => {
    setParameters(freshParameters()); setMode('kinetic'); setShowMesh(false); setTrueScale(false);
    setPlot('narrowing'); setPinned(null); clearResults();
  };

  const calculate = type => {
    const id = ++runId.current;
    setTask(type); setProgress(0); setPlaying(false); setError(''); setNotice('');
    if (type === 'sweep') setCurve(null); else { setSimulation(null); setCurrentFrame(0); }
    workerRef.current?.terminate();
    try {
      const worker = new Worker(new URL('./simulation.worker.js', import.meta.url));
      workerRef.current = worker;
      const finish = () => { worker.terminate(); workerRef.current = null; setTask(null); };
      worker.onmessage = ({ data }) => {
        if (data.id !== runId.current) return;
        if (data.type === 'progress') { setProgress(data.progress); return; }
        if (data.type === 'error') setError(data.message);
        else if (type === 'sweep') setCurve(data.result);
        else {
          setSimulation(data.result); setCurrentFrame(0); setClock(0);
          setPlaying(data.result.mode === 'kinetic' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        }
        finish();
      };
      worker.onerror = event => {
        if (id !== runId.current) return;
        setError(event.message || 'The calculation could not finish. Try resetting the defaults.'); finish();
      };
      worker.postMessage({ id, type, parameters, mode });
    } catch (problem) {
      workerRef.current?.terminate(); workerRef.current = null; setTask(null); setError(problem.message);
    }
  };
  const cancel = () => {
    runId.current++; workerRef.current?.terminate(); workerRef.current = null;
    setTask(null); setNotice('Calculation cancelled.');
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ ...simulation, stiffnessSweep: curve }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `airway-${simulation.mode}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const handleScrubTime = useCallback(targetTime => {
    if (simulation?.mode !== 'kinetic') return;
    setPlaying(false);
    const clamped = Math.max(0, Math.min(600, targetTime));
    setClock(clamped);
    setCurrentFrame(frameAtTime(simulation.frames, clamped));
  }, [simulation]);

  const referenceRadii = useMemo(() => Array.from({ length: parameters.radialIntervals + 1 },
    (_, i) => parameters.innerRadius + (parameters.outerRadius - parameters.innerRadius) * i / parameters.radialIntervals),
  [parameters.radialIntervals, parameters.innerRadius, parameters.outerRadius]);
  const selected = simulation?.frames[Math.min(currentFrame, simulation.frames.length - 1)];
  const pinnedFrame = useMemo(() => {
    if (!pinned?.frames?.length) return null;
    if (pinned.mode === 'kinetic' && selected?.time !== null && selected?.time !== undefined) {
      return pinned.frames[frameAtTime(pinned.frames, selected.time)];
    }
    return pinned.frames[0];
  }, [pinned, selected]);

  // While playing, draw between accepted equilibria so the wall moves smoothly.
  // Every number shown still comes from the accepted frame.
  const drawnRadii = useMemo(() => {
    const next = simulation?.frames[currentFrame + 1];
    if (!playing || !next || clock <= selected.time) return selected?.radii;
    const weight = Math.min(1, (clock - selected.time) / (next.time - selected.time));
    return selected.radii.map((radius, i) => radius + weight * (next.radii[i] - radius));
  }, [playing, clock, simulation, currentFrame, selected]);

  const drawnSectorRadii = useMemo(() => {
    if (!selected?.sectorRadii) return null;
    const next = simulation?.frames[currentFrame + 1];
    if (!playing || !next?.sectorRadii || clock <= selected.time) return selected.sectorRadii;
    const weight = Math.min(1, (clock - selected.time) / (next.time - selected.time));
    return selected.sectorRadii.map((row, s) => row.map((radius, i) => radius + weight * (next.sectorRadii[s][i] - radius)));
  }, [playing, clock, simulation, currentFrame, selected]);

  const magnification = useMemo(() => trueScale ? 1
    : deformationScale(simulation?.referenceRadii || referenceRadii, simulation?.frames),
  [trueScale, simulation, referenceRadii]);

  const chartData = useMemo(() => {
    if (!selected) return null;
    const p = selected.profile;
    const pp = pinnedFrame?.profile;
    const nodePoints = (arr, ref = p.referenceRadii) => ref.map((R, i) => ({ x: R, y: arr[i] }));
    const midPoints = (arr, mid = p.midpointRadii) => mid.map((R, i) => ({ x: R, y: arr[i] }));
    const wallCharts = p ? {
      displacement: [
        { label: 'Displacement', color: 'var(--cell)', points: nodePoints(p.displacement) },
        ...(pp ? [{ label: 'Pinned', color: 'var(--muted)', dashed: true, muted: true, points: nodePoints(pp.displacement, pp.referenceRadii) }] : []),
      ],
      stretch: [
        { label: 'Circumferential λθ', color: 'var(--muscle)', points: midPoints(p.hoopStretch) },
        { label: 'Radial λr', color: 'var(--cartilage)', dashed: true, points: midPoints(p.radialStretch) },
      ],
      stress: [
        { label: 'Circumferential stress', color: 'var(--text)', points: midPoints(p.hoopStress) },
        { label: 'Radial stress', color: 'var(--latch)', dashed: true, points: midPoints(p.radialStress) },
      ],
    } : {};

    if (simulation.mode !== 'kinetic') return wallCharts;
    const { frames, protocol } = simulation;
    const series = (label, color, key, dashed = false, muted = false, customFrames = frames) => ({
      label, color, dashed, muted,
      points: customFrames.map(frame => ({ x: frame.time, y: typeof key === 'function' ? key(frame) : frame[key] })),
    });
    const inputPoints = [];
    protocol.switchTimes.forEach((t, i) => {
      if (i) inputPoints.push({ x: t, y: protocol.kinaseRates[i - 1] });
      inputPoints.push({ x: t, y: protocol.kinaseRates[i] });
    });
    inputPoints.push({ x: 600, y: 0 });
    const hasPinnedKinetic = pinned?.mode === 'kinetic';
    return {
      narrowing: [
        series('Narrowing', 'var(--cell)', 'narrowingPercent'),
        ...(hasPinnedKinetic ? [series('Pinned', 'var(--muted)', 'narrowingPercent', true, true, pinned.frames)] : []),
      ],
      tension: [
        series('Total', 'var(--text)', 'tensionDensity'),
        series('AMp contribution', 'var(--muscle)', f => simulation.parameters.tensionScale * f.states[2], true),
        series('Latch contribution', 'var(--latch)', f => simulation.parameters.tensionScale * f.states[3], true),
      ],
      states: [
        series('M · detached', 'var(--muted)', f => f.states[0]),
        series('Mp · phosphorylated', 'var(--phosphorylated)', f => f.states[1]),
        series('AMp · attached', 'var(--muscle)', f => f.states[2]),
        series('AM · latch', 'var(--latch)', f => f.states[3]),
      ],
      input: [{ label: 'k1 = k6', color: 'var(--kinase)', points: inputPoints }],
      ...wallCharts,
    };
  }, [simulation, selected, pinned, pinnedFrame]);

  const plots = {
    narrowing: { title: 'Lumen narrowing', yLabel: 'Narrowing (%)', isTime: true },
    tension: { title: 'Muscle tension', yLabel: 'Tension density', isTime: true },
    states: { title: 'Cross-bridges', yLabel: 'Population fraction', yLimit: 1, isTime: true },
    input: { title: 'Kinase input', yLabel: 'Rate (1/s)', isTime: true },
    displacement: { title: 'Wall displacement', yLabel: 'Radial displacement (r − R)', isTime: false },
    stretch: { title: 'Wall stretch', yLabel: 'Stretch ratio λ', isTime: false },
    stress: { title: 'Wall stress', yLabel: 'Stress (dimensionless)', isTime: false },
  };
  const activePlotKey = chartData?.[plot] ? plot : (simulation?.mode === 'kinetic' ? 'narrowing' : 'displacement');
  const activePlot = plots[activePlotKey];

  return <main className="app">
    <header>
      <h1>Airway smooth muscle contraction</h1>
      <p className="byline">By <a href="https://egbonjefri.github.io/">Jeffery Osagie</a>{' · '}
        <a href={`${REPOSITORY}/blob/main/backend/sim.ipynb`}>Notebook</a>{' · '}
        <a href={REPOSITORY}>Source</a></p>
    </header>

    <div className="workspace">
      <section className="figure" aria-label="Airway geometry and current result">
        <GridVisualizer
          radii={drawnRadii || referenceRadii}
          referenceRadii={simulation?.referenceRadii || referenceRadii}
          sectorRadii={drawnSectorRadii}
          sectors={parameters.sectors}
          narrowing={selected?.narrowingPercent ?? null}
          showMesh={showMesh}
          magnification={magnification}
        />
        <ul className="legend">{LAYERS.map(layer => <li key={layer.key}>
          <span className="swatch" style={{ background: STAIN[layer.key] }} aria-hidden="true" />{layer.label}</li>)}</ul>
        <p className="figure-caption">{magnification === 1 ? 'True scale' : `Deformation ×${magnification}`}
          {selected && ' · dashed: resting lumen'}</p>

        {simulation?.mode === 'kinetic' && <>
          <div className="playback">
            <button type="button" className="secondary" onClick={() => {
              if (currentFrame === simulation.frames.length - 1) { frameRef.current = 0; setCurrentFrame(0); }
              setPlaying(value => !value);
            }}>{playing ? 'Pause' : currentFrame === simulation.frames.length - 1 ? 'Replay' : 'Play'}</button>
            <button type="button" className="secondary" onClick={() => { setPlaying(false); setCurrentFrame(0); setClock(0); }}>To start</button>
            <label htmlFor="playback-speed">Speed</label>
            <select id="playback-speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>
              {[5, 10, 30, 60].map(value => <option key={value} value={value}>{value}×</option>)}
            </select>
          </div>
          <div className="time-scrubber">
            <label htmlFor="kinetic-time">Time</label>
            <output htmlFor="kinetic-time">{selected.time.toFixed(2)} s / 600 s</output>
            <input id="kinetic-time" type="range" min={0} max={simulation.frames.length - 1} value={currentFrame}
              aria-valuetext={`${selected.time.toFixed(2)} seconds`} onChange={event => {
                const idx = Number(event.target.value);
                setPlaying(false); setCurrentFrame(idx); setClock(simulation.frames[idx].time);
              }} />
          </div>
        </>}
        {selected ? <>
          {simulation.mode === 'kinetic' && (
            <p className="result-summary">
              Peak narrowing <strong>{simulation.summary.peakNarrowing.toFixed(3)}%</strong> at{' '}
              {simulation.summary.peakTime.toFixed(2)} s. At 600 s: {simulation.summary.finalNarrowing.toFixed(3)}%.
            </p>
          )}
          <div className="result-actions">
            <details className="diagnostics">
              <summary>Result details</summary>
              <dl className="results" aria-label="Selected result">
                <div><dt>Active tension density</dt><dd>{selected.tensionDensity.toFixed(3)}</dd></div>
                {simulation.mode === 'kinetic' && <>
                  <div><dt>Attached (AMp + AM)</dt><dd>{(100 * selected.attachedFraction).toFixed(2)}%</dd></div>
                  <div><dt>Phosphorylated (Mp + AMp)</dt><dd>{(100 * selected.phosphorylation).toFixed(2)}%</dd></div>
                </>}
                <div><dt>Lumen area</dt><dd>{selected.lumenArea.toFixed(5)}</dd></div>
                <div><dt>Accepted equilibria</dt><dd>{simulation.frames.length}</dd></div>
                <div><dt>Maximum force density</dt><dd>{simulation.summary.maxResidualDensity.toExponential(2)}</dd></div>
                <div><dt>Force tolerance</dt><dd>1e−7</dd></div>
              </dl>
            </details>
            <div className="action-buttons">
              <button type="button" className="text-button" onClick={() => setPinned(pinned === simulation ? null : simulation)}>
                {pinned === simulation ? 'Unpin' : 'Pin to compare'}
              </button>
              <button type="button" className="secondary download" onClick={download}>Export JSON</button>
            </div>
          </div>
        </> : null}
      </section>

      <section className="panel" aria-label="Simulation controls">
        <div className="run-bar">
          <label htmlFor="experiment-mode" className="sr-only">Experiment</label>
          <select id="experiment-mode" value={mode} disabled={busy} onChange={event => selectMode(event.target.value)}>
            <option value="kinetic">Activation & relaxation</option>
            <option value="prescribed">Prescribed activation</option>
          </select>
          <button type="button" disabled={busy} onClick={() => calculate('simulation')}>
            {task === 'simulation' ? `Running… ${Math.round(progress * 100)}%` : 'Run model'}
          </button>
        </div>
        {busy && <progress value={progress} max={1} aria-label="Calculation progress" />}
        <p className="status" role="status">{notice}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <fieldset disabled={busy}>
          <div className="primary-control">
            {mode === 'kinetic'
              ? <Slider id="peak-kinase" label={<>Initial kinase rate (s<sup>−1</sup>)</>} value={parameters.peakKinase} min={0} max={1} step={.05} onChange={value => change('peakKinase', value)} />
              : <Slider id="activation" label="Prescribed activation" value={parameters.activation} min={0} max={1} step={.05} format={value => `${(100 * value).toFixed(0)}%`} onChange={value => change('activation', value)} />}
          </div>
          <details className="settings-group">
            <summary>{mode === 'kinetic' ? 'Activation settings' : 'Muscle settings'}</summary>
            {mode === 'kinetic' && <p className="note">Initial kinase input: 10–30 s.</p>}
            <div className="control-grid">
              {mode === 'kinetic' && <>
                <Slider id="sustained-kinase" label={<>Kinase, 30 s–off (s<sup>−1</sup>)</>} value={parameters.sustainedKinase} min={0} max={.5} step={.01} onChange={value => change('sustainedKinase', value)} />
                <Slider id="withdrawal-time" label="Kinase off (s)" value={parameters.withdrawalTime} min={40} max={300} step={10} onChange={value => change('withdrawalTime', value)} />
                <Slider id="latch-detachment" label={<>Latch detachment (s<sup>−1</sup>)</>} value={parameters.latchDetachment} min={.005} max={.1} step={.005}
                  format={value => value.toFixed(3)} onChange={value => change('latchDetachment', value)} />
              </>}
              <Slider id="tension-scale" label="Max. tension density" value={parameters.tensionScale} min={0} max={20} step={1} onChange={value => change('tensionScale', value)} />
              {mode === 'kinetic' && (
                <Slider id="strain-feedback" label="Strain feedback" value={parameters.strainFeedback} min={0} max={2} step={.1}
                  format={value => value === 0 ? 'Off' : formatNumber(value)} onChange={value => change('strainFeedback', value)} />
              )}
            </div>
            {mode === 'kinetic' && <p className="note">Fixed rates (s<sup>−1</sup>): k<sub>2</sub> = k<sub>5</sub> = 0.5, k<sub>3</sub> = 0.4, k<sub>4</sub> = 0.1.</p>}
          </details>
          <details className="settings-group">
            <summary>Tissue stiffness</summary>
            <div className="control-grid tissue-controls">
              {LAYERS.map(layer => <Slider key={layer.key} id={`modulus-${layer.key}`} label={layer.label} value={parameters.moduli[layer.key]}
                min={layer.base/4} max={layer.base*4} step={layer.base/4} onChange={value => changeLayer(layer.key, value)} />)}
            </div>
            <div className="control-grid multiplier-control">
              <Slider id="non-muscle-multiplier" label="Non-muscle multiplier" value={parameters.nonMuscleMultiplier} min={.25} max={4} step={.25}
                format={value => `${formatNumber(value)}×`} onChange={value => change('nonMuscleMultiplier', value)} />
              <Slider id="outer-stiffness" label="Outer boundary" value={parameters.outerStiffness ?? 0} min={0} max={200} step={10}
                format={value => value === 0 ? 'Fixed' : `k = ${formatNumber(value)}`}
                onChange={value => change('outerStiffness', value === 0 ? null : value)} />
            </div>
            <p className="note">Wall quantities are dimensionless.</p>
            {mode === 'prescribed' && <button type="button" className="secondary compare-button" onClick={() => calculate('sweep')}>
              {task === 'sweep' ? `Comparing… ${Math.round(progress * 100)}%` : 'Compare tissue stiffness'}</button>}
          </details>
          <details className="settings-group mesh-settings">
            <summary>View & mesh</summary>
            <label className="checkbox-control"><input id="true-scale" type="checkbox" checked={trueScale} onChange={event => setTrueScale(event.target.checked)} />True-scale deformation</label>
            <label className="checkbox-control"><input id="show-mesh" type="checkbox" checked={showMesh} onChange={event => setShowMesh(event.target.checked)} />Show mesh</label>
            <div className="select-control"><label htmlFor="radial-intervals">Radial intervals</label>
              <select id="radial-intervals" value={parameters.radialIntervals} onChange={event => change('radialIntervals', Number(event.target.value))}>
                {[10, 20, 40].map(value => <option key={value} value={value}>{value} intervals ({value + 1} rings)</option>)}
              </select></div>
            <div className="select-control"><label htmlFor="sectors">Angular sectors</label>
              <select id="sectors" value={parameters.sectors} onChange={event => change('sectors', Number(event.target.value))}>
                {[40, 80, 160].map(value => <option key={value} value={value}>{value}</option>)}
              </select></div>
            <div className="control-grid multiplier-control">
              <Slider id="cartilage-gap" label="Cartilage plate gap" value={parameters.cartilageGap} min={0} max={.8} step={.05}
                format={value => value === 0 ? 'Ring' : `${Math.round(100 * value)}%`}
                onChange={value => change('cartilageGap', value)} />
              <Slider id="mucosal-folding" label="Mucosal folding" value={parameters.mucosalFolding} min={0} max={.6} step={.05}
                format={value => value === 0 ? 'Off' : formatNumber(value)}
                onChange={value => change('mucosalFolding', value)} />
            </div>
            <p className="note">Layer interfaces: r = 1.2, 1.5, 1.8.</p>
          </details>
        </fieldset>
        <div className="panel-utility">
          {busy ? <button type="button" className="text-button" onClick={cancel}>Cancel</button>
            : <button type="button" className="text-button" onClick={restoreDefaults}>Reset defaults</button>}
        </div>
      </section>
    </div>

    {chartData && activePlot && <section className="curve" aria-labelledby="chart-heading">
      <div className="chart-toolbar">
        <h2 id="chart-heading">{activePlot.isTime ? 'Time course' : 'Wall profile'}</h2>
        <label htmlFor="chart-plot" className="sr-only">Plot</label>
        <select id="chart-plot" value={activePlotKey} onChange={event => setPlot(event.target.value)}>
          {simulation.mode === 'kinetic' && (
            <optgroup label="Over time">
              <option value="narrowing">Lumen narrowing</option>
              <option value="tension">Muscle tension</option>
              <option value="states">Cross-bridges</option>
              <option value="input">Kinase input</option>
            </optgroup>
          )}
          <optgroup label="Across the wall">
            <option value="displacement">Wall displacement</option>
            <option value="stretch">Wall stretch</option>
            <option value="stress">Wall stress</option>
          </optgroup>
        </select>
      </div>
      <LineChart
        {...activePlot}
        series={chartData[activePlotKey]}
        xLabel={activePlot.isTime ? 'Time (s)' : 'Reference radius R'}
        xTicks={activePlot.isTime ? undefined : [1, 1.2, 1.5, 1.8, 2]}
        markers={activePlot.isTime ? [] : WALL_MARKERS}
        cursor={activePlot.isTime ? selected.time : undefined}
        onScrub={activePlot.isTime ? handleScrubTime : undefined}
        showTitle={false}
      />
    </section>}

    {curve && <section className="curve" aria-label="Tissue stiffness comparison" ref={comparisonRef}>
      <StiffnessCurveChart data={curve.points} activationSeries={curve.activationSeries} />
      <p className="note">{(100 * curve.parameters.activation).toFixed(0)}% activation · muscle modulus {formatNumber(curve.parameters.moduli.muscle)} ·
        maximum tension density {formatNumber(curve.parameters.tensionScale)}</p>
      <details className="sweep-values">
        <summary>View values</summary>
        <table className="sweep-table">
          <thead>
            <tr>
              <th scope="col">Non-muscle multiplier</th>
              {(curve.activations || [curve.parameters.activation]).map(act => (
                <th key={act} scope="col">{(100 * act).toFixed(0)}%</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {curve.points.map((point, mIdx) => (
              <tr key={point.x}>
                <th scope="row">{point.x}×</th>
                {curve.grid ? curve.grid[mIdx].map((val, aIdx) => (
                  <td key={curve.activations[aIdx]}>{val.toFixed(3)}%</td>
                )) : <td>{point.y.toFixed(3)}%</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>}

    <details className="model-notes">
      <summary>Model assumptions</summary>
      <p>Radial motion is magnified up to 10× to make small deformations visible. The scale shown below the diagram
        stays fixed throughout each run and is reduced for large contractions. Percentages, plots, and exported
        radii use the actual model results. Tissue textures are illustrative, and the cartilage is a schematic
        continuous ring by default.</p>
      <p>Axisymmetric, compressible neo-Hookean wall in plane strain; fixed outer boundary by default; Poisson ratio 0.25.
        Circumferential tension is proportional to attached cross-bridges (AMp + AM).
        Each time point is a static wall equilibrium.</p>
      <p><a href="https://doi.org/10.1152/ajpcell.1988.255.1.C86">Hai–Murphy kinetics</a> use rates fitted to swine carotid muscle.
        Parameters are illustrative, without airway calibration. The 600 s endpoint is not a steady-state limit.</p>
    </details>
  </main>;
}
export default App;
