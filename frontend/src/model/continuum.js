// Browser counterpart of backend/continuum.py.
// Rotational symmetry lets us integrate one sector and repeat it exactly.
// Two-dimensional forces at a representative node include BOTH adjacent
// sectors; rotating these vectors gives every node's force on its ring.

export const TISSUES = ['mucosa', 'muscle', 'cartilage', 'adventitia'];
export const DEFAULT_MODULI = Object.freeze({ mucosa: 25, muscle: 50, cartilage: 150, adventitia: 75 });

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const multiply = (a, b) => [
  a[0]*b[0] + a[1]*b[2], a[0]*b[1] + a[1]*b[3],
  a[2]*b[0] + a[3]*b[2], a[2]*b[1] + a[3]*b[3],
];
const apply = (a, v) => [a[0]*v[0] + a[1]*v[1], a[2]*v[0] + a[3]*v[1]];
const traceProduct = (a, b) => a[0]*b[0] + a[1]*b[2] + a[2]*b[1] + a[3]*b[3];
const ordered = radii => radii.every((r, i) => Number.isFinite(r) && r > 0 && (!i || r > radii[i - 1]));

function solveTridiagonal(diagonal, offDiagonal, rhs) {
  const n = rhs.length;
  const lower = new Float64Array(n);
  const root = new Float64Array(n);
  const solution = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lower[i] = i ? offDiagonal[i - 1] / root[i - 1] : 0;
    const pivot = diagonal[i] - lower[i] ** 2;
    if (!Number.isFinite(pivot) || pivot <= 0) throw new Error('The symmetric wall branch has lost positive stiffness.');
    root[i] = Math.sqrt(pivot);
    solution[i] = (rhs[i] - (i ? lower[i] * solution[i - 1] : 0)) / root[i];
  }
  for (let i = n - 1; i >= 0; i--) {
    solution[i] = (solution[i] - (i + 1 < n ? lower[i + 1] * solution[i + 1] : 0)) / root[i];
  }
  return solution;
}

export class ContinuumAirway {
  constructor({ radialIntervals = 20, sectors = 80, innerRadius = 1, outerRadius = 2,
    moduli = DEFAULT_MODULI, poissonRatio = .25, activeStress = 20, radialTraction = 0 } = {}) {
    if (!Number.isInteger(radialIntervals) || radialIntervals < 10 || radialIntervals % 10) {
      throw new Error('Radial intervals must be a positive multiple of 10 to resolve every tissue interface.');
    }
    if (!Number.isInteger(sectors) || sectors < 8) throw new Error('Use at least 8 angular sectors.');
    if (![innerRadius, outerRadius, poissonRatio, activeStress, radialTraction].every(Number.isFinite)
      || innerRadius <= 0 || outerRadius <= innerRadius || poissonRatio <= -1 || poissonRatio >= .5 || activeStress < 0) {
      throw new Error('Invalid wall geometry, Poisson ratio, or tension scale.');
    }
    if (!moduli || Object.keys(moduli).length !== 4
      || TISSUES.some(key => !Number.isFinite(moduli[key]) || moduli[key] <= 0)) {
      throw new Error('All four tissue moduli must be finite and positive.');
    }
    Object.assign(this, { radialIntervals, sectors, innerRadius, outerRadius, poissonRatio, activeStress, radialTraction });
    this.moduli = { ...moduli };
    this.referenceRadii = Array.from({ length: radialIntervals + 1 }, (_, i) => innerRadius + (outerRadius - innerRadius)*i/radialIntervals);
    const angle = 2 * Math.PI / sectors;
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    this.initialArea = sectors * this.sin * innerRadius ** 2 / 2;
    this.boundaryLength = 2 * innerRadius * Math.sin(Math.PI / sectors);
    this.nodeAreas = new Float64Array(radialIntervals + 1);
    this.quadrature = [];
    const q = 1 / Math.sqrt(3);
    const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const directions = [[1, 0], [1, 0], [this.cos, this.sin], [this.cos, this.sin]];
    for (let ring = 0; ring < radialIntervals; ring++) {
      const r0 = this.referenceRadii[ring], r1 = this.referenceRadii[ring + 1];
      const nodes = [[r0, 0], [r1, 0], [r1*this.cos, r1*this.sin], [r0*this.cos, r0*this.sin]];
      const fraction = (ring + .5) / radialIntervals;
      const layer = fraction < .2 ? 0 : fraction < .5 ? 1 : fraction < .8 ? 2 : 3;
      const young = moduli[TISSUES[layer]];
      const mu = young / (2 * (1 + poissonRatio));
      const lame = young * poissonRatio / ((1 + poissonRatio) * (1 - 2 * poissonRatio));
      for (const [xi, eta] of [[-q, -q], [q, -q], [q, q], [-q, q]]) {
        const shape = signs.map(([sx, sy]) => (1 + xi*sx) * (1 + eta*sy) / 4);
        const derivatives = signs.map(([sx, sy]) => [sx*(1 + eta*sy)/4, sy*(1 + xi*sx)/4]);
        const jacobian = [0, 0, 0, 0];
        for (let a = 0; a < 4; a++) {
          jacobian[0] += nodes[a][0]*derivatives[a][0];
          jacobian[1] += nodes[a][0]*derivatives[a][1];
          jacobian[2] += nodes[a][1]*derivatives[a][0];
          jacobian[3] += nodes[a][1]*derivatives[a][1];
        }
        const weight = jacobian[0]*jacobian[3] - jacobian[1]*jacobian[2];
        if (weight <= 0) throw new Error('Invalid reference element.');
        const inverse = [jacobian[3]/weight, -jacobian[1]/weight, -jacobian[2]/weight, jacobian[0]/weight];
        const gradients = derivatives.map(([a, b]) => [a*inverse[0] + b*inverse[2], a*inverse[1] + b*inverse[3]]);
        const position = [0, 1].map(j => nodes.reduce((sum, node, a) => sum + shape[a]*node[j], 0));
        const norm = Math.hypot(...position);
        const tangent = [-position[1]/norm, position[0]/norm];
        const basis = [[0, 0, 0, 0], [0, 0, 0, 0]];
        for (let a = 0; a < 4; a++) {
          const b = basis[a === 0 || a === 3 ? 0 : 1];
          for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) b[2*i + j] += directions[a][i]*gradients[a][j];
        }
        this.nodeAreas[ring] += weight * (shape[0] + shape[3]);
        this.nodeAreas[ring + 1] += weight * (shape[1] + shape[2]);
        this.quadrature.push({ ring, layer, mu, lame, weight, gradients, tangent, basis,
          fiberBasis: basis.map(b => apply(b, tangent)) });
      }
    }
  }

  evaluate(radii, activation, withTangent = true) {
    if (!Number.isFinite(activation) || activation < 0 || activation > 1) throw new Error('Attachment / activation must be between 0 and 1.');
    if (radii.length !== this.referenceRadii.length || !ordered(radii)) throw new Error('Wall radii must be finite, positive, and ordered.');
    const n = radii.length;
    const gradient = new Float64Array(n), diagonal = new Float64Array(n), offDiagonal = new Float64Array(n - 1);
    const forces = Array.from({ length: n }, () => [0, 0]);
    let energy = 0, minimumJacobian = Infinity;
    for (const point of this.quadrature) {
      const { ring, layer, mu, lame, weight, gradients, tangent, basis, fiberBasis } = point;
      const F = basis[0].map((v, j) => radii[ring]*v + radii[ring + 1]*basis[1][j]);
      const J = F[0]*F[3] - F[1]*F[2];
      if (!Number.isFinite(J) || J <= 0) throw new Error('A wall element has a nonpositive Jacobian.');
      minimumJacobian = Math.min(minimumJacobian, J);
      const inverse = [F[3]/J, -F[1]/J, -F[2]/J, F[0]/J];
      const logJ = Math.log(J);
      const fiber = apply(F, tangent), stretch = Math.hypot(...fiber);
      const unit = fiber.map(v => v / stretch);
      const tension = layer === 1 ? this.activeStress * activation : 0;
      energy += weight * (mu/2*(dot(F, F) - 2) - mu*logJ + lame/2*logJ**2 + tension*(stretch - 1));
      const pressure = lame*logJ - mu;
      const P = [mu*F[0] + pressure*inverse[0] + tension*unit[0]*tangent[0],
        mu*F[1] + pressure*inverse[2] + tension*unit[0]*tangent[1],
        mu*F[2] + pressure*inverse[1] + tension*unit[1]*tangent[0],
        mu*F[3] + pressure*inverse[3] + tension*unit[1]*tangent[1]];
      const localForces = gradients.map(g => apply(P, g).map(v => -weight*v));
      for (const [target, left, right] of [[ring, 0, 3], [ring + 1, 1, 2]]) {
        // Rotate the preceding sector's right-hand node back by one angle.
        forces[target][0] += localForces[left][0] + this.cos*localForces[right][0] + this.sin*localForces[right][1];
        forces[target][1] += localForces[left][1] - this.sin*localForces[right][0] + this.cos*localForces[right][1];
      }
      for (let a = 0; a < 2; a++) gradient[ring + a] += weight * dot(P, basis[a]);
      if (withTangent) {
        const inverseBasis = basis.map(b => multiply(inverse, b));
        const traces = inverseBasis.map(b => b[0] + b[3]);
        const along = fiberBasis.map(b => dot(unit, b));
        for (let a = 0; a < 2; a++) for (let b = a; b < 2; b++) {
          const value = weight * (mu*dot(basis[a], basis[b])
            + (mu - lame*logJ)*traceProduct(inverseBasis[a], inverseBasis[b]) + lame*traces[a]*traces[b]
            + tension/stretch*(dot(fiberBasis[a], fiberBasis[b]) - along[a]*along[b]));
          if (a === b) diagonal[ring + a] += value;
          else offDiagonal[ring] += value;
        }
      }
    }
    energy = this.sectors * (energy - this.radialTraction*this.boundaryLength*(radii[0] - this.innerRadius));
    forces[0][0] += this.radialTraction*this.boundaryLength;
    gradient[0] -= this.radialTraction*this.boundaryLength;
    for (let i = 0; i < n; i++) {
      gradient[i] *= this.sectors;
      diagonal[i] *= this.sectors;
      if (i < n - 1) offDiagonal[i] *= this.sectors;
    }
    const residualDensity = Math.max(...forces.slice(0, -1).map((f, i) => Math.hypot(...f) / this.nodeAreas[i]));
    if (![energy, residualDensity, minimumJacobian].every(Number.isFinite)) throw new Error('Wall calculation produced a non-finite result.');
    return { energy, gradient, diagonal, offDiagonal, forces, residualDensity, minimumJacobian };
  }

  solve(activation = 1, { forceDensityTol = 1e-7, maxIterations = 60 } = {}) {
    if (!Number.isFinite(forceDensityTol) || forceDensityTol <= 0 || !Number.isInteger(maxIterations) || maxIterations < 0) {
      throw new Error('Invalid equilibrium solver tolerance or iteration limit.');
    }
    let radii = [...this.referenceRadii];
    const history = [];
    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      const state = this.evaluate(radii, activation);
      history.push({ iteration, potential: state.energy, residualDensity: state.residualDensity, minimumJacobian: state.minimumJacobian });
      if (state.residualDensity <= forceDensityTol || iteration === maxIterations) {
        const lumenArea = this.sectors * this.sin * radii[0]**2 / 2;
        return { converged: state.residualDensity <= forceDensityTol, iterations: iteration,
          residualDensity: state.residualDensity, minimumJacobian: state.minimumJacobian,
          potential: state.energy, lumenArea, narrowingPercent: 100 * (1 - lumenArea / this.initialArea),
          radii, history };
      }
      const direction = solveTridiagonal(state.diagonal, state.offDiagonal, state.gradient.slice(0, -1).map(v => -v));
      const slope = dot(direction, state.gradient);
      let step = 1, accepted = false;
      for (let trialIndex = 0; trialIndex < 40; trialIndex++) {
        const trial = radii.map((r, i) => r + (i < direction.length ? step*direction[i] : 0));
        let energy = Infinity;
        if (ordered(trial)) {
          try { energy = this.evaluate(trial, activation, false).energy; } catch { /* Reject inadmissible trial. */ }
        }
        if (energy <= state.energy + 1e-4*step*slope + 1e-12*Math.max(1, Math.abs(state.energy))) {
          radii = trial;
          accepted = true;
          break;
        }
        step *= .5;
      }
      if (!accepted) throw new Error('No admissible energy-decreasing equilibrium step.');
    }
    throw new Error('Equilibrium iteration failed.');
  }
}
