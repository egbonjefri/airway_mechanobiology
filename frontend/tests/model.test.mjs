import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ContinuumAirway, DEFAULT_MODULI } from '../src/model/continuum.js';
import { DEFAULT_RATES, generator, simulateKinetics, steadyState, advancePopulation, notebookTimes, kinaseAt } from '../src/model/kinetics.js';
import { runSimulation, generateStiffnessCurve, DEFAULT_PARAMS } from '../src/simulation.js';
import { displayRadii, deformationScale } from '../src/deformation.js';

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const mesh = load('../../backend/results/mesh_convergence.json');
const sweep = load('../../backend/results/stiffness_sweep.json');
const kinetic = load('../../backend/results/time_course.json');
const independent = load('./python-reference.json');
const close = (actual, expected, tolerance = 1e-10, label = '') => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected}, tolerance ${tolerance}`);
};
const arrayClose = (actual, expected, tolerance, label = '') => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, i) => Array.isArray(value) || ArrayBuffer.isView(value)
    ? arrayClose(value, expected[i], tolerance, `${label}[${i}]`)
    : close(value, expected[i], tolerance, `${label}[${i}]`));
};

test('custom fixtures match the current Python source', () => {
  for (const [name, digest] of Object.entries(independent.source_sha256)) {
    const hash = createHash('sha256').update(readFileSync(new URL(`../../backend/${name}`, import.meta.url))).digest('hex');
    assert.equal(hash, digest, 'Regenerate fixtures: python -m backend.export_browser_reference');
  }
});

test('all 11 notebook refinement meshes match the Python equilibria', () => {
  for (const reference of mesh.cases) {
    const wall = new ContinuumAirway({ radialIntervals: reference.radial_intervals, sectors: reference.sectors });
    const result = wall.solve(1);
    assert.equal(result.converged, true);
    assert.ok(result.residualDensity <= 1e-7);
    close(result.narrowingPercent, reference.narrowing_percent, 2e-7);
    close(result.lumenArea, reference.lumen_area, 1e-8);
    close(result.minimumJacobian, reference.minimum_jacobian, 1e-8);
    arrayClose(result.radii, reference.radii, 2e-9);
    assert.equal(result.radii.at(-1), wall.outerRadius);
  }
});

test('all 25 stiffness–activation cases match the notebook continuum sweep', () => {
  for (const reference of sweep.cases) {
    const moduli = Object.fromEntries(Object.entries(DEFAULT_MODULI).map(([key, value]) =>
      [key, value * (key === 'muscle' ? 1 : reference.stiffness_multiplier)]));
    const wall = new ContinuumAirway({ moduli });
    const result = wall.solve(reference.activation);
    assert.equal(result.converged, true);
    close(result.narrowingPercent, reference.narrowing_percent, 2e-7);
    arrayClose(result.radii.map((r, i) => r - wall.referenceRadii[i]), reference.radial_displacement, 2e-9);
  }
});

test('arbitrary materials, outer tethering and wall profiles match Python energy, tangent and 2D force density', () => {
  for (const reference of independent.wall_cases) {
    const wall = new ContinuumAirway(reference.parameters);
    const state = wall.evaluate(reference.probe_radii, reference.activation);
    close(state.energy, reference.probe_energy, 1e-10);
    arrayClose(state.gradient, reference.probe_gradient, 2e-9);
    const hessian = Array.from({ length: reference.probe_radii.length }, (_, i) =>
      Array.from({ length: reference.probe_radii.length }, (_, j) => i === j ? state.diagonal[i]
        : Math.abs(i - j) === 1 ? state.offDiagonal[Math.min(i, j)] : 0));
    arrayClose(hessian, reference.probe_hessian, 2e-8);
    close(state.residualDensity, reference.probe_residual_density, 1e-7);
    close(state.minimumJacobian, reference.probe_minimum_jacobian, 1e-12);
    const result = wall.solve(reference.activation);
    arrayClose(result.radii, reference.equilibrium_radii, 2e-9);
    close(result.narrowingPercent, reference.narrowing_percent, 2e-7);
    if (reference.profile) {
      const profile = wall.wallProfile(result.radii, reference.activation);
      arrayClose(profile.displacement, reference.profile.displacement, 2e-9);
      arrayClose(profile.radialStretch, reference.profile.radial_stretch, 2e-9);
      arrayClose(profile.hoopStretch, reference.profile.hoop_stretch, 2e-9);
      arrayClose(profile.radialStress, reference.profile.radial_stress, 2e-7);
      arrayClose(profile.hoopStress, reference.profile.hoop_stress, 2e-7);
      close(profile.muscleStretch, reference.profile.muscle_stretch, 2e-9);
    }
  }
});

test('asymmetric cartilage segmentation and mucosal folding match Python reference', () => {
  const ref = independent.asymmetric_case;
  const wall = new ContinuumAirway(ref.parameters);
  const solved = wall.solveAsymmetric(ref.activation, ref.options);
  arrayClose(solved.radii, ref.radii, 2e-9);
  arrayClose(solved.sectorRadii, ref.sector_radii, 2e-9);
  close(solved.lumenArea, ref.lumen_area, 1e-8);
  close(solved.narrowingPercent, ref.narrowing_percent, 2e-7);
});

test('all 993 kinetic samples reproduce the Python matrix exponential without population correction', () => {
  const states = simulateKinetics(notebookTimes());
  arrayClose(states, kinetic.states, 2e-12);
  states.forEach(state => {
    assert.ok(Math.min(...state) >= 0);
    close(state.reduce((sum, value) => sum + value, 0), 1, 1e-12);
  });
});

test('edited rates, steady state, initial fractions and switches absent from the grid match Python', () => {
  const r = independent.kinetic_case;
  arrayClose(simulateKinetics(r.times, r.protocol, r.rates, r.initial), r.states, 2e-12);
  arrayClose(simulateKinetics([r.times.at(-1)], r.protocol, r.rates, r.initial)[0], r.states.at(-1), 2e-12);
  arrayClose(advancePopulation(r.initial, 0, r.times.at(-1), r.protocol, r.rates), r.states.at(-1), 2e-12);
  if (r.steady_state_071) {
    arrayClose(steadyState(.71, r.rates), r.steady_state_071, 2e-12);
  }
  assert.equal(kinaseAt(.37, r.protocol), .71);
});

test('two-way mechanochemical strain feedback matches Python coupled_response', () => {
  const c = independent.coupled_case;
  const sim = runSimulation({
    radialIntervals: c.radial_intervals,
    sectors: c.sectors,
    outerStiffness: c.outer_stiffness,
    strainFeedback: c.strain_feedback,
  });
  c.times.forEach((t, idx) => {
    const frame = sim.frames.find(f => f.time === t);
    assert.ok(frame, `Missing time ${t}`);
  });
  const uncoupled = runSimulation({ radialIntervals: 10, sectors: 24 });
  const coupled = runSimulation({ radialIntervals: 10, sectors: 24, strainFeedback: 0.8 });
  assert.ok(coupled.summary.peakNarrowing < uncoupled.summary.peakNarrowing);
  assert.ok(coupled.frames.at(-1).states[3] < uncoupled.frames.at(-1).states[3]);
});

test('all seven isolated transitions have the correct exponential solution', () => {
  for (const [name, source, destination] of [['k1', 0, 1], ['k2', 1, 0], ['k3', 1, 2],
    ['k4', 2, 1], ['k5', 2, 3], ['k6', 3, 2], ['k7', 3, 0]]) {
    const rates = Object.fromEntries(Object.keys(DEFAULT_RATES).map(key => [key, key === name ? .7 : 0]));
    const protocol = { switchTimes: [0], kinaseRates: [name === 'k1' || name === 'k6' ? .7 : 0] };
    const initial = [0, 0, 0, 0]; initial[source] = 1;
    const times = [0, .1, 1, 10];
    simulateKinetics(times, protocol, rates, initial).forEach((state, i) => {
      const expected = [0, 0, 0, 0]; expected[source] = Math.exp(-.7 * times[i]); expected[destination] = 1 - expected[source];
      arrayClose(state, expected, 1e-13);
    });
  }
});

test('complete browser time course matches all 993 notebook wall snapshots', () => {
  const result = runSimulation();
  assert.equal(result.frames.length, 993);
  result.frames.forEach((frame, i) => {
    assert.equal(frame.time, kinetic.time_seconds[i]);
    arrayClose(frame.radii, kinetic.wall.radii[i], 2e-9);
    close(frame.narrowingPercent, kinetic.wall.narrowing_percent[i], 2e-7);
    close(frame.tensionDensity, kinetic.wall.tension_density[i], 1e-10);
    assert.ok(frame.residualDensity <= 1e-7 && frame.minimumJacobian > 0);
    assert.ok(frame.radii.every((r, j) => r > 0 && (!j || r > frame.radii[j - 1])));
    assert.equal(frame.radii.at(-1), 2);
    assert.ok(frame.profile && frame.profile.displacement.length === 21);
  });
  close(result.summary.peakNarrowing, kinetic.peak_narrowing_percent, 2e-7);
  assert.equal(result.summary.peakTime, kinetic.peak_time_seconds);
});

test('zero input and zero tension limits do not narrow the wall', () => {
  for (const parameters of [{ peakKinase: 0, sustainedKinase: 0 }, { tensionScale: 0 }]) {
    const result = runSimulation(parameters);
    result.frames.forEach(frame => close(frame.narrowingPercent, 0, 1e-12));
  }
});

test('prescribed activation and 2D stiffness comparison match the notebook and carry no kinetic time', () => {
  const result = runSimulation({}, { mode: 'prescribed' });
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].time, null);
  assert.equal(result.rates, null);
  close(result.frames[0].narrowingPercent, 5.350552600653, 2e-7);
  const curve = generateStiffnessCurve();
  curve.points.forEach(point => {
    const reference = sweep.cases.find(r => r.stiffness_multiplier === point.x && r.activation === 1);
    close(point.y, reference.narrowing_percent, 2e-7);
  });
  assert.equal(curve.grid.length, 5);
  curve.multipliers.forEach((mult, mIdx) => {
    curve.activations.forEach((act, aIdx) => {
      const reference = sweep.cases.find(r => r.stiffness_multiplier === mult && r.activation === act);
      close(curve.grid[mIdx][aIdx], reference.narrowing_percent, 2e-7);
    });
  });
  const soft = runSimulation({ moduli: { ...DEFAULT_MODULI, cartilage: 37.5 } }, { mode: 'prescribed' });
  assert.ok(soft.frames[0].narrowingPercent > result.frames[0].narrowingPercent);
  assert.equal(DEFAULT_PARAMS.moduli.cartilage, 150, 'Defaults must not be mutated');
});

test('deformation scaling chooses readable magnification factors', () => {
  const ref = [1, 1.5, 2];
  assert.deepEqual(displayRadii(ref, [.98, 1.49, 2], 1), [.98, 1.49, 2]);
  arrayClose(displayRadii(ref, [.98, 1.49, 2], 10), [.8, 1.4, 2], 1e-12);
  assert.equal(deformationScale(ref, [{ radii: [.98, 1.49, 2] }]), 10);
  assert.equal(deformationScale(ref, [{ radii: [.85, 1.45, 2] }]), 2);
  assert.equal(deformationScale(ref, [{ radii: [.4, 1.2, 2] }]), 1);
});

test('failed solves and invalid parameters are rejected rather than exported', () => {
  assert.equal(new ContinuumAirway().solve(1, { maxIterations: 0 }).converged, false);
  assert.throws(() => runSimulation({}, { mode: 'prescribed', solverOptions: { maxIterations: 0 } }), /did not converge/);
  assert.throws(() => generateStiffnessCurve({}, { solverOptions: { maxIterations: 0 } }), /did not converge/);
  for (const parameters of [{ radialIntervals: 9 }, { sectors: 3 }, { poissonRatio: .5 },
    { activeStress: -1 }, { moduli: { muscle: 50 } }, { outerStiffness: 0 }, { outerStiffness: -2 }]) {
    assert.throws(() => new ContinuumAirway(parameters));
  }
  for (const parameters of [{ activation: 2 }, { nonMuscleMultiplier: 0 }, { withdrawalTime: 30 },
    { peakKinase: -1 }, { latchDetachment: NaN }, { moduli: { muscle: -1 } },
    { strainFeedback: -1 }, { cartilageGap: .95 }, { mucosalFolding: .95 }]) {
    assert.throws(() => runSimulation(parameters));
  }
  assert.throws(() => new ContinuumAirway().solve(NaN));
  assert.throws(() => simulateKinetics([0, 0]));
  assert.throws(() => generator(-1));
  assert.throws(() => simulateKinetics([0], { switchTimes: [0], kinaseRates: [0] }, DEFAULT_RATES, [0, 0, 0, 0]));
});
