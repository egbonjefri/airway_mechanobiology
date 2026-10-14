import React, { useState, useEffect, useMemo } from 'react';
import GridVisualizer from './GridVisualizer';
import StiffnessCurveChart from './StiffnessCurveChart';
import { DEFAULT_PARAMS, describeAirway, runSimulation as simulateAirway } from './simulation';
import './index.css';

function Slider({ id, label, value, min, max, step, format = String, onChange, disabled }) {
  return (
    <div className="control">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{format(value)}</output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  );
}

function App() {
  // Simulation parameters
  const [stiffness, setStiffness] = useState(DEFAULT_PARAMS.stiffness);
  const [cellForce, setCellForce] = useState(DEFAULT_PARAMS.cell_force);
  const [numRadial, setNumRadial] = useState(DEFAULT_PARAMS.num_radial);
  const [numCircum, setNumCircum] = useState(DEFAULT_PARAMS.num_circum);

  // Simulation results
  const [simulationData, setSimulationData] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  // Batch simulation for curve
  const [curve, setCurve] = useState(null);
  const [isGeneratingCurve, setIsGeneratingCurve] = useState(false);
  const [curveProgress, setCurveProgress] = useState(0);

  // The undeformed airway, drawn until a simulation has run
  const preview = useMemo(
    () => describeAirway({ num_radial: numRadial, num_circum: numCircum }),
    [numRadial, numCircum]
  );

  // A result only describes the parameters it was run with, so clear it when they change
  useEffect(() => {
    setSimulationData(null);
    setIsPlaying(false);
    setCurrentFrame(0);
  }, [stiffness, cellForce, numRadial, numCircum]);

  // Animation playback
  useEffect(() => {
    if (isPlaying && simulationData) {
      const interval = setInterval(() => {
        setCurrentFrame(prev => {
          if (prev >= simulationData.positions.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 50); // 20 fps

      return () => clearInterval(interval);
    }
  }, [isPlaying, simulationData]);

  const runSimulation = async () => {
    setLoading(true);
    try {
      const data = await simulateAirway({
        stiffness,
        cell_force: cellForce,
        num_radial: numRadial,
        num_circum: numCircum
      });

      setSimulationData(data);
      setCurrentFrame(0);
      setIsPlaying(true);
    } catch (error) {
      console.error('Error running simulation:', error);
      alert('Failed to run simulation.');
    } finally {
      setLoading(false);
    }
  };

  const generateCurve = async () => {
    setIsGeneratingCurve(true);
    setCurveProgress(0);
    try {
      // Generate stiffness values from 10 to 100
      const stiffnesses = Array.from({ length: 10 }, (_, i) => 10 + i * 10);
      const points = [];

      for (const k of stiffnesses) {
        const data = await simulateAirway({
          stiffness: k,
          cell_force: cellForce,
          num_radial: numRadial,
          num_circum: numCircum
        }, { keepFrames: false });

        points.push({ x: k, y: data.final_constriction });
        setCurveProgress(points.length);
      }

      setCurve({ points, cellForce, numRadial, numCircum });
    } catch (error) {
      console.error('Error generating curve:', error);
      alert('Failed to generate curve.');
    } finally {
      setIsGeneratingCurve(false);
    }
  };

  const togglePlayback = () => {
    if (currentFrame >= simulationData.positions.length - 1) {
      setCurrentFrame(0);
    }
    setIsPlaying(!isPlaying);
  };

  const resetSimulation = () => {
    setCurrentFrame(0);
    setIsPlaying(false);
  };

  const busy = loading || isGeneratingCurve;
  const mesh = simulationData ?? preview;
  const lastFrame = mesh.positions.length - 1;
  const frame = Math.min(currentFrame, lastFrame);

  return (
    <main className="app">
      <header>
        <h1>Airway smooth muscle contraction simulator</h1>
        <p className="lede">
          A cross-section of the airway wall modelled as a mass-spring network.
          Smooth muscle cells in the middle ring pull along the circumference,
          the outer ring is held fixed, and the simulation runs until the wall
          stops moving.
        </p>
        <p className="byline">
          By <a href="https://egbonjefri.github.io/">Jeffery Osagie</a>
          {' · '}
          <a href="https://github.com/egbonjefri/airway_mechanobiology">Source on GitHub</a>
        </p>
      </header>

      <div className="workspace">
        <div className="figure">
          <GridVisualizer
            positions={mesh.positions[frame]}
            springs={mesh.springs}
            cells={mesh.cells}
            fixedIndices={mesh.fixed_indices}
            numCircum={mesh.num_circum}
          />
          <ul className="legend">
            <li><span className="swatch swatch-cell" aria-hidden="true" />Smooth muscle cells</li>
            <li><span className="swatch swatch-fixed" aria-hidden="true" />Fixed outer ring</li>
            <li><span className="swatch swatch-lumen" aria-hidden="true" />Lumen</li>
          </ul>

          {simulationData && (
            <div className="playback">
              <button type="button" className="secondary" onClick={togglePlayback}>
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button type="button" className="secondary" onClick={resetSimulation}>Reset</button>
              <input
                type="range"
                aria-label="Frame"
                min="0"
                max={lastFrame}
                value={frame}
                onChange={e => {
                  setIsPlaying(false);
                  setCurrentFrame(Number(e.target.value));
                }}
              />
              <output>Frame {frame} / {lastFrame}</output>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Parameters</h2>
          <Slider
            id="stiffness"
            label={<>Stiffness <i>k</i></>}
            value={stiffness}
            min="10"
            max="100"
            step="5"
            onChange={setStiffness}
            disabled={busy}
          />
          <Slider
            id="cell-force"
            label="Cell force"
            value={cellForce}
            min="0.5"
            max="5"
            step="0.5"
            format={v => v.toFixed(1)}
            onChange={setCellForce}
            disabled={busy}
          />
          <Slider
            id="num-radial"
            label="Rings"
            value={numRadial}
            min="5"
            max="12"
            step="1"
            onChange={setNumRadial}
            disabled={busy}
          />
          <Slider
            id="num-circum"
            label="Nodes per ring"
            value={numCircum}
            min="12"
            max="48"
            step="4"
            onChange={setNumCircum}
            disabled={busy}
          />

          <div className="buttons">
            <button type="button" onClick={runSimulation} disabled={busy}>
              {loading ? 'Running…' : 'Run simulation'}
            </button>
            <button type="button" className="secondary" onClick={generateCurve} disabled={busy}>
              {isGeneratingCurve ? `Generating… (${curveProgress}/10)` : 'Generate stiffness curve'}
            </button>
          </div>

          {simulationData ? (
            <dl className="results">
              <div>
                <dt>Lumen constriction</dt>
                <dd>{simulationData.constriction[frame].toFixed(2)}%</dd>
              </div>
              <div>
                <dt>At steady state</dt>
                <dd>
                  {simulationData.final_constriction.toFixed(2)}%
                  {!simulationData.settled && ' (not settled)'}
                </dd>
              </div>
              <div>
                <dt>Steps to settle</dt>
                <dd>{simulationData.steps}</dd>
              </div>
              <div>
                <dt>Starting lumen area</dt>
                <dd>{simulationData.initial_area.toFixed(3)}</dd>
              </div>
              <div>
                <dt>Masses, springs, muscle cells</dt>
                <dd>
                  {simulationData.num_masses}, {simulationData.springs.length}, {simulationData.cells.length}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="note">Run the simulation to watch the wall contract.</p>
          )}
        </div>
      </div>

      {curve && (
        <section className="curve" aria-labelledby="curve-heading">
          <h2 id="curve-heading">Stiffness and constriction</h2>
          <StiffnessCurveChart data={curve.points} />
          <p className="note">
            Each point is a separate run with cell force {curve.cellForce.toFixed(1)},{' '}
            {curve.numRadial} rings and {curve.numCircum} nodes per ring. Every
            spring has the same stiffness and the cells pull with the same force
            whatever it is, so narrowing here scales with cell force ÷ stiffness.
          </p>
        </section>
      )}
    </main>
  );
}

export default App;
