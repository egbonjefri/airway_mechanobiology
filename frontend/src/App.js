import React, { useState, useEffect } from 'react';
import GridVisualizer from './GridVisualizer';
import StiffnessCurveChart from './StiffnessCurveChart';
import { DEFAULT_PARAMS, runSimulation as simulateAirway } from './simulation';
import './index.css';

function App() {
  // Simulation parameters
  const [stiffness, setStiffness] = useState(DEFAULT_PARAMS.stiffness);
  const [cellForce, setCellForce] = useState(DEFAULT_PARAMS.cell_force);
  const [numRadial, setNumRadial] = useState(DEFAULT_PARAMS.num_radial);
  const [numCircum, setNumCircum] = useState(DEFAULT_PARAMS.num_circum);
  
  // Simulation results
  const [simulationData, setSimulationData] = useState(null);
  const [positions, setPositions] = useState([]);
  const [constriction, setConstriction] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Batch simulation for curve
  const [curveData, setCurveData] = useState([]);
  const [isGeneratingCurve, setIsGeneratingCurve] = useState(false);
  const [curveProgress, setCurveProgress] = useState(0);
  const [loading, setLoading] = useState(false);

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

  // Update displayed positions based on current frame
  useEffect(() => {
    if (simulationData && simulationData.positions[currentFrame]) {
      setPositions(simulationData.positions[currentFrame]);
      setConstriction(simulationData.constriction[currentFrame]);
    }
  }, [currentFrame, simulationData]);

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
      setPositions(data.positions[0]);
      setConstriction(data.constriction[0]);
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
      const results = [];

      for (const k of stiffnesses) {
        const data = await simulateAirway({
          stiffness: k,
          cell_force: cellForce,
          num_radial: numRadial,
          num_circum: numCircum
        }, { keepFrames: false });

        results.push({ x: k, y: data.final_constriction });
        setCurveProgress(results.length);
      }

      setCurveData(results);
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

  return (
    <div className="app">
      <h1>Airway Smooth Muscle Contraction Simulator</h1>
      
      <div className="controls-panel">
        <h2>Simulation Parameters</h2>
        
        <div className="control-group">
          <label>Stiffness (k): </label>
          <input 
            type="range" 
            min="10" 
            max="100" 
            step="5" 
            value={stiffness} 
            onChange={e => setStiffness(parseFloat(e.target.value))}
            disabled={loading || isGeneratingCurve}
          />
          <span>{stiffness.toFixed(1)}</span>
        </div>

        <div className="control-group">
          <label>Cell Force: </label>
          <input 
            type="range" 
            min="0.5" 
            max="5" 
            step="0.5" 
            value={cellForce} 
            onChange={e => setCellForce(parseFloat(e.target.value))}
            disabled={loading || isGeneratingCurve}
          />
          <span>{cellForce.toFixed(1)}</span>
        </div>

        <div className="control-group">
          <label>Grid Resolution (Radial): </label>
          <input 
            type="range" 
            min="5" 
            max="12" 
            step="1" 
            value={numRadial} 
            onChange={e => setNumRadial(parseInt(e.target.value))}
            disabled={loading || isGeneratingCurve}
          />
          <span>{numRadial}</span>
        </div>

        <div className="control-group">
          <label>Grid Resolution (Circumferential): </label>
          <input 
            type="range" 
            min="12" 
            max="48" 
            step="4" 
            value={numCircum} 
            onChange={e => setNumCircum(parseInt(e.target.value))}
            disabled={loading || isGeneratingCurve}
          />
          <span>{numCircum}</span>
        </div>

        <div className="button-group">
          <button 
            onClick={runSimulation} 
            disabled={loading || isGeneratingCurve}
          >
            {loading ? 'Running...' : 'Run Simulation'}
          </button>
          <button 
            onClick={generateCurve}
            disabled={loading || isGeneratingCurve}
          >
            {isGeneratingCurve ? `Generating... (${curveProgress}/10)` : 'Generate Stiffness Curve'}
          </button>
        </div>
      </div>

      {simulationData && (
        <div className="playback-controls">
          <button onClick={togglePlayback}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={resetSimulation}>Reset</button>
          <input 
            type="range" 
            min="0" 
            max={simulationData.positions.length - 1} 
            value={currentFrame}
            onChange={e => {
              setIsPlaying(false);
              setCurrentFrame(parseInt(e.target.value));
            }}
          />
          <span>Frame: {currentFrame} / {simulationData.positions.length - 1}</span>
        </div>
      )}

      <div className="viz-container">
        <GridVisualizer 
          positions={positions}
          springs={simulationData?.springs}
          cells={simulationData?.cells}
          fixedIndices={simulationData?.fixed_indices}
          numRadial={simulationData?.num_radial}
          numCircum={simulationData?.num_circum}
        />
      </div>

      {simulationData && (
        <div className="results">
          <p><strong>Lumen Constriction:</strong> {constriction.toFixed(2)}%</p>
          <p><strong>Steady-State Constriction:</strong> {simulationData.final_constriction.toFixed(2)}%{!simulationData.settled && ' (not settled)'}</p>
          <p><strong>Steps to Steady State:</strong> {simulationData.steps}</p>
          <p><strong>Initial Area:</strong> {simulationData.initial_area.toFixed(3)}</p>
          <p><strong>Total Masses:</strong> {simulationData.num_masses}</p>
          <p><strong>Total Springs:</strong> {simulationData.springs.length}</p>
          <p><strong>ASM Cells:</strong> {simulationData.cells.length}</p>
        </div>
      )}

      {curveData.length > 0 && (
        <div className="curve-container">
          <h2>Stiffness vs Constriction Curve</h2>
          <StiffnessCurveChart data={curveData} />
        </div>
      )}
    </div>
  );
}

export default App;