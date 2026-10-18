// The browser uses the same model as backend/sim.ipynb.
// The legacy mass-spring implementation remains in backend/simulation.py.
import { ContinuumAirway, DEFAULT_MODULI, TISSUES } from './model/continuum.js';
import { DEFAULT_RATES, simulateKinetics, advancePopulation, notebookTimes, kinaseAt } from './model/kinetics.js';

export const DEFAULT_PARAMS = Object.freeze({
  radialIntervals: 20, sectors: 80, innerRadius: 1, outerRadius: 2,
  moduli: DEFAULT_MODULI, poissonRatio: .25, tensionScale: 20,
  nonMuscleMultiplier: 1, activation: 1,
  radialTraction: 0, outerStiffness: null,
  cartilageGap: 0, cartilagePlates: 4, mucosalFolding: 0, mucosalFolds: 8,
  peakKinase: .55, sustainedKinase: .10, withdrawalTime: 120, latchDetachment: .01,
  k2: .5, k3: .4, k4: .1, k5: .5, strainFeedback: 0,
});
export const FORCE_DENSITY_TOLERANCE = 1e-7;

export function normalizeParams(input = {}) {
  const outerStiffness = input.outerStiffness === undefined ? DEFAULT_PARAMS.outerStiffness : input.outerStiffness;
  const params = {
    ...DEFAULT_PARAMS,
    ...input,
    outerStiffness,
    moduli: { ...DEFAULT_MODULI, ...input.moduli },
  };
  if (![params.nonMuscleMultiplier, params.activation, params.peakKinase, params.sustainedKinase,
    params.withdrawalTime, params.latchDetachment, params.k2, params.k3, params.k4, params.k5,
    params.strainFeedback, params.radialTraction, params.cartilageGap, params.mucosalFolding].every(Number.isFinite)
    || params.nonMuscleMultiplier <= 0 || params.activation < 0 || params.activation > 1
    || params.peakKinase < 0 || params.sustainedKinase < 0 || params.latchDetachment < 0
    || params.k2 < 0 || params.k3 < 0 || params.k4 < 0 || params.k5 < 0 || params.strainFeedback < 0
    || params.cartilageGap < 0 || params.cartilageGap > .85
    || params.mucosalFolding < 0 || params.mucosalFolding > .8
    || params.withdrawalTime <= 30 || params.withdrawalTime >= 600
    || (params.outerStiffness !== null && (!Number.isFinite(params.outerStiffness) || params.outerStiffness <= 0))) {
    throw new Error('Check the material multiplier, boundary conditions, activation, and kinetic protocol. Withdrawal must be between 30 and 600 seconds.');
  }
  return params;
}

export function wallForParams(params) {
  const moduli = Object.fromEntries(TISSUES.map(key => [key, params.moduli[key] * (key === 'muscle' ? 1 : params.nonMuscleMultiplier)]));
  return new ContinuumAirway({ ...params, moduli, activeStress: params.tensionScale });
}

function acceptedFrame(wall, activation, solverOptions, params = DEFAULT_PARAMS) {
  const asymmetric = params.cartilageGap > 0 || params.mucosalFolding > 0;
  const result = asymmetric
    ? wall.solveAsymmetric(activation, {
      cartilageGap: params.cartilageGap, cartilagePlates: params.cartilagePlates,
      mucosalFolding: params.mucosalFolding, mucosalFolds: params.mucosalFolds,
      forceDensityTol: FORCE_DENSITY_TOLERANCE, ...solverOptions,
    })
    : wall.solve(activation, { forceDensityTol: FORCE_DENSITY_TOLERANCE, ...solverOptions });
  if (!result.converged || result.minimumJacobian <= 0
    || (wall.outerStiffness === null && result.radii.at(-1) !== wall.outerRadius)) {
    throw new Error(`Wall equilibrium did not converge (force density ${result.residualDensity.toExponential(2)}). No result was accepted.`);
  }
  const { history, ...frame } = result;
  const profile = wall.wallProfile(result.radii, activation);
  return { ...frame, attachedFraction: activation, tensionDensity: wall.activeStress * activation, profile };
}

export function runSimulation(input = {}, { mode = 'kinetic', onProgress = () => {}, solverOptions = {} } = {}) {
  if (!['kinetic', 'prescribed'].includes(mode)) throw new Error('Unknown simulation mode.');
  const parameters = normalizeParams(input);
  const wall = wallForParams(parameters);
  const rates = {
    ...DEFAULT_RATES,
    k2: parameters.k2, k3: parameters.k3, k4: parameters.k4, k5: parameters.k5,
    k7: parameters.latchDetachment,
  };
  const protocol = { switchTimes: [0, 10, 30, parameters.withdrawalTime],
    kinaseRates: [0, parameters.peakKinase, parameters.sustainedKinase, 0] };
  // Include an edited withdrawal time even when it lies between normal samples.
  const times = [...new Set([...notebookTimes(), parameters.withdrawalTime])].sort((a, b) => a - b);
  let frames;
  if (mode === 'kinetic') {
    if (parameters.strainFeedback === 0) {
      const populations = simulateKinetics(times, protocol, rates);
      frames = populations.map((states, index) => {
        const attached = states[2] + states[3];
        // Match the Python coupling's endpoint roundoff guard; never alter states.
        const frame = acceptedFrame(wall, Math.min(1, Math.max(0, attached)), solverOptions, parameters);
        if (index % 20 === 0 || index === times.length - 1) onProgress((index + 1) / times.length);
        return { ...frame, time: times[index], states, attachedFraction: attached,
          phosphorylation: states[1] + states[2], kinaseRate: kinaseAt(times[index], protocol) };
      });
    } else {
      let state = [1, 0, 0, 0], currentTime = 0, muscleStrain = 0;
      frames = times.map((target, index) => {
        const stepRates = { ...rates, k7: rates.k7 * (1 + 10 * parameters.strainFeedback * muscleStrain) };
        state = advancePopulation(state, currentTime, target, protocol, stepRates);
        currentTime = target;
        const attached = state[2] + state[3];
        const overlap = Math.exp(-parameters.strainFeedback * muscleStrain ** 2);
        const effActivation = Math.min(1, Math.max(0, attached * overlap));
        const frame = acceptedFrame(wall, effActivation, solverOptions, parameters);
        muscleStrain = Math.abs(1 - frame.profile.muscleStretch);
        if (index % 20 === 0 || index === times.length - 1) onProgress((index + 1) / times.length);
        return { ...frame, time: target, states: state, attachedFraction: attached,
          effectiveActivation: effActivation, phosphorylation: state[1] + state[2],
          kinaseRate: kinaseAt(target, protocol) };
      });
    }
  } else {
    frames = [{ ...acceptedFrame(wall, parameters.activation, solverOptions, parameters), time: null, states: null }];
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
    assumptions: [
      parameters.outerStiffness === null
        ? 'Symmetric compressible neo-Hookean wall; fixed outer boundary'
        : `Compressible neo-Hookean wall; elastic outer tethering (k = ${parameters.outerStiffness})`,
      parameters.strainFeedback === 0
        ? 'Quasistatic one-way coupling; no wall viscosity or force–velocity feedback'
        : `Two-way mechanochemical strain feedback (γ = ${parameters.strainFeedback})`,
      'Vascular kinetic rate reference; illustrative, uncalibrated airway mechanics',
    ],
  };
}

export function generateStiffnessCurve(input = {}, { onProgress = () => {}, solverOptions = {} } = {}) {
  const parameters = normalizeParams(input);
  const multipliers = [.25, .5, 1, 2, 4];
  const activations = [0, .25, .5, .75, 1];
  const totalSteps = multipliers.length * (activations.length + 1);
  let completed = 0;
  const walls = multipliers.map(multiplier => wallForParams({ ...parameters, nonMuscleMultiplier: multiplier }));
  const points = multipliers.map((multiplier, index) => {
    const result = acceptedFrame(walls[index], parameters.activation, solverOptions, parameters);
    completed++;
    onProgress(completed / totalSteps);
    return { x: multiplier, y: result.narrowingPercent, ...result };
  });
  const grid = multipliers.map((multiplier, mIdx) => activations.map(act => {
    const result = acceptedFrame(walls[mIdx], act, solverOptions, parameters);
    completed++;
    onProgress(completed / totalSteps);
    return result.narrowingPercent;
  }));
  const activationSeries = multipliers.map((multiplier, mIdx) => ({
    multiplier,
    points: activations.map((act, aIdx) => ({ x: act, y: grid[mIdx][aIdx] })),
  }));
  return { model: 'hai-murphy-continuum-v1', parameters, multipliers, activations, points, grid, activationSeries };
}
