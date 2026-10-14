// The browser uses the same final model as sim.ipynb sections 11–12.
// The legacy mass-spring implementation remains in backend/simulation.py.
import { ContinuumAirway, DEFAULT_MODULI, TISSUES } from './model/continuum.js';
import { DEFAULT_RATES, simulateKinetics, notebookTimes, kinaseAt } from './model/kinetics.js';

export const DEFAULT_PARAMS = Object.freeze({
  radialIntervals: 20, sectors: 80, innerRadius: 1, outerRadius: 2,
  moduli: DEFAULT_MODULI, poissonRatio: .25, tensionScale: 20,
  nonMuscleMultiplier: 1, activation: 1,
  peakKinase: .55, sustainedKinase: .10, withdrawalTime: 120, latchDetachment: .01,
});
export const FORCE_DENSITY_TOLERANCE = 1e-7;

export function normalizeParams(input = {}) {
  const params = { ...DEFAULT_PARAMS, ...input, moduli: { ...DEFAULT_MODULI, ...input.moduli } };
  if (![params.nonMuscleMultiplier, params.activation, params.peakKinase, params.sustainedKinase,
    params.withdrawalTime, params.latchDetachment].every(Number.isFinite)
    || params.nonMuscleMultiplier <= 0 || params.activation < 0 || params.activation > 1
    || params.peakKinase < 0 || params.sustainedKinase < 0 || params.latchDetachment < 0
    || params.withdrawalTime <= 30 || params.withdrawalTime >= 600) {
    throw new Error('Check the material multiplier, activation, and kinetic protocol. Withdrawal must be between 30 and 600 seconds.');
  }
  return params;
}

export function wallForParams(params) {
  const moduli = Object.fromEntries(TISSUES.map(key => [key, params.moduli[key] * (key === 'muscle' ? 1 : params.nonMuscleMultiplier)]));
  return new ContinuumAirway({ ...params, moduli, activeStress: params.tensionScale });
}

function acceptedFrame(wall, activation, solverOptions) {
  const result = wall.solve(activation, { forceDensityTol: FORCE_DENSITY_TOLERANCE, ...solverOptions });
  if (!result.converged || result.minimumJacobian <= 0 || result.radii.at(-1) !== wall.outerRadius) {
    throw new Error(`Wall equilibrium did not converge (force density ${result.residualDensity.toExponential(2)}). No result was accepted.`);
  }
  const { history, ...frame } = result;
  return { ...frame, attachedFraction: activation, tensionDensity: wall.activeStress * activation };
}

export function runSimulation(input = {}, { mode = 'kinetic', onProgress = () => {}, solverOptions = {} } = {}) {
  if (!['kinetic', 'prescribed'].includes(mode)) throw new Error('Unknown simulation mode.');
  const parameters = normalizeParams(input);
  const wall = wallForParams(parameters);
  const rates = { ...DEFAULT_RATES, k7: parameters.latchDetachment };
  const protocol = { switchTimes: [0, 10, 30, parameters.withdrawalTime],
    kinaseRates: [0, parameters.peakKinase, parameters.sustainedKinase, 0] };
  // Include an edited withdrawal time even when it lies between normal samples.
  const times = [...new Set([...notebookTimes(), parameters.withdrawalTime])].sort((a, b) => a - b);
  let frames;
  if (mode === 'kinetic') {
    const populations = simulateKinetics(times, protocol, rates);
    frames = populations.map((states, index) => {
      const attached = states[2] + states[3];
      // Match the Python coupling's endpoint roundoff guard; never alter states.
      const frame = acceptedFrame(wall, Math.min(1, Math.max(0, attached)), solverOptions);
      if (index % 20 === 0 || index === times.length - 1) onProgress((index + 1) / times.length);
      return { ...frame, time: times[index], states, attachedFraction: attached,
        phosphorylation: states[1] + states[2], kinaseRate: kinaseAt(times[index], protocol) };
    });
  } else {
    frames = [{ ...acceptedFrame(wall, parameters.activation, solverOptions), time: null, states: null }];
    onProgress(1);
  }
  const peakIndex = frames.reduce((best, frame, i) => frame.narrowingPercent > frames[best].narrowingPercent ? i : best, 0);
  return {
    schemaVersion: 1, model: 'hai-murphy-continuum-v1', mode, parameters,
    effectiveModuli: wall.moduli, protocol: mode === 'kinetic' ? protocol : null,
    rates: mode === 'kinetic' ? rates : null,
    units: { kineticTime: 'seconds', rates: '1/seconds', wallGeometryModuliTension: 'dimensionless' },
    referenceRadii: wall.referenceRadii, initialArea: wall.initialArea, frames,
    summary: { peakIndex, peakNarrowing: frames[peakIndex].narrowingPercent,
      peakTime: frames[peakIndex].time, finalNarrowing: frames.at(-1).narrowingPercent,
      maxResidualDensity: Math.max(...frames.map(frame => frame.residualDensity)),
      minimumJacobian: Math.min(...frames.map(frame => frame.minimumJacobian)) },
    assumptions: ['Symmetric compressible neo-Hookean wall; fixed outer boundary',
      'Quasistatic one-way coupling; no wall viscosity or force–velocity feedback',
      'Vascular kinetic rate reference; illustrative, uncalibrated airway mechanics'],
  };
}

export function generateStiffnessCurve(input = {}, { onProgress = () => {}, solverOptions = {} } = {}) {
  const parameters = normalizeParams(input);
  const multipliers = [.25, .5, 1, 2, 4];
  const points = multipliers.map((multiplier, index) => {
    const wall = wallForParams({ ...parameters, nonMuscleMultiplier: multiplier });
    const result = acceptedFrame(wall, parameters.activation, solverOptions);
    onProgress((index + 1) / multipliers.length);
    return { x: multiplier, y: result.narrowingPercent, ...result };
  });
  return { model: 'hai-murphy-continuum-v1', parameters, points };
}
