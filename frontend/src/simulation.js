// Browser port of backend/simulation.py, so the app runs without a server.
// Keep the two in step: the physics and update order in stepVerlet match line
// for line. Unlike the Python version, runSimulation keeps going until the
// airway stops moving instead of stopping after a fixed number of steps.

export const DEFAULT_PARAMS = {
  num_radial: 8,
  num_circum: 24,
  inner_radius: 1.0,
  outer_radius: 2.0,
  mass: 1.0,
  damping: 0.8,
  stiffness: 50.0,
  cell_force: 2.0,
  // dt = 0.1 is well inside the stability limit across the slider ranges, and
  // reaches the same steady state as dt = 0.01 in far fewer steps
  dt: 0.1,
  save_interval: 2,
  // Settled once no node moves more than this in a substep
  settle_tolerance: 1e-8,
  max_steps: 100000,
};

const MAX_FRAMES = 120;
const SLICE_MS = 16;

/**
 * Mass-spring model of an airway cross-section:
 * - Cylindrical geometry (airway cross-section)
 * - Verlet integration (stable)
 * - Diagonal springs (shear resistance)
 * - Orientation-dependent cell forces
 */
export class CylindricalAirway {
  constructor(params = {}) {
    const {
      num_radial, num_circum, inner_radius, outer_radius,
      mass, damping, stiffness, cell_force,
    } = { ...DEFAULT_PARAMS, ...params };

    this.numRadial = num_radial;
    this.numCircum = num_circum;
    this.numMasses = num_radial * num_circum;
    this.mass = mass;
    this.damping = damping;

    // Initialize positions in cylindrical grid, stored as [x0, y0, x1, y1, ...]
    this.positions = new Float64Array(this.numMasses * 2);
    for (let r = 0; r < num_radial; r++) {
      const radius = inner_radius + (outer_radius - inner_radius) * (r / (num_radial - 1));
      for (let c = 0; c < num_circum; c++) {
        const angle = (2 * Math.PI * c) / num_circum;
        const idx = r * num_circum + c;
        this.positions[2 * idx] = radius * Math.cos(angle);
        this.positions[2 * idx + 1] = radius * Math.sin(angle);
      }
    }
    this.prevPositions = this.positions.slice();

    // Create springs: circumferential, radial, and diagonal
    this.springs = [];
    const addSpring = (m1, m2, k) => {
      this.springs.push({ m1, m2, k, rest_length: this.distance(m1, m2) });
    };
    for (let r = 0; r < num_radial; r++) {
      for (let c = 0; c < num_circum; c++) {
        const idx = r * num_circum + c;
        const nextC = (c + 1) % num_circum;

        // Circumferential spring
        addSpring(idx, r * num_circum + nextC, stiffness);

        // Radial spring
        if (r < num_radial - 1) {
          addSpring(idx, (r + 1) * num_circum + c, stiffness);

          // Diagonal springs (shear resistance)
          const prevC = (c - 1 + num_circum) % num_circum;
          addSpring(idx, (r + 1) * num_circum + nextC, stiffness * 0.5);
          addSpring(idx, (r + 1) * num_circum + prevC, stiffness * 0.5);
        }
      }
    }

    // Create ASM cells in middle layer, oriented along the circumference
    this.cells = [];
    const midLayer = Math.floor(num_radial / 2);
    for (let c = 0; c < num_circum; c++) {
      const idx = midLayer * num_circum + c;
      const next = midLayer * num_circum + ((c + 1) % num_circum);
      const len = this.distance(idx, next);
      this.cells.push({
        mass_idx: idx,
        next_idx: next,
        force_strength: cell_force,
        orientation: [
          (this.positions[2 * next] - this.positions[2 * idx]) / len,
          (this.positions[2 * next + 1] - this.positions[2 * idx + 1]) / len,
        ],
      });
    }

    // Fix outer layer (tethered to surrounding tissue)
    this.fixed = [];
    for (let c = 0; c < num_circum; c++) {
      this.fixed.push((num_radial - 1) * num_circum + c);
    }

    // Store initial area for constriction calculation
    this.initialArea = this.computeInnerArea();
  }

  distance(i, j) {
    const p = this.positions;
    return Math.hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1]);
  }

  /** Area enclosed by the innermost ring, using the shoelace formula. */
  computeInnerArea() {
    const p = this.positions;
    let area = 0;
    for (let c = 0; c < this.numCircum; c++) {
      const next = (c + 1) % this.numCircum;
      area += p[2 * c] * p[2 * next + 1] - p[2 * next] * p[2 * c + 1];
    }
    return Math.abs(area) / 2;
  }

  /** Damped Verlet integration with substeps for stability. */
  stepVerlet(dt = 0.01, substeps = 5) {
    const subDt = dt / substeps;
    const n = this.positions.length;

    for (let s = 0; s < substeps; s++) {
      const current = this.positions;
      const prev = this.prevPositions;

      // x_new = x + (x - x_prev) * damping + a * dt^2
      const next = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        next[i] = current[i] + (current[i] - prev[i]) * this.damping;
      }

      const forces = new Float64Array(n);

      // Spring forces
      for (const { m1, m2, k, rest_length } of this.springs) {
        const vx = current[2 * m2] - current[2 * m1];
        const vy = current[2 * m2 + 1] - current[2 * m1 + 1];
        const dist = Math.hypot(vx, vy);
        if (dist < 1e-6) continue;

        const forceMag = k * (dist - rest_length);
        const fx = (forceMag * vx) / dist;
        const fy = (forceMag * vy) / dist;
        forces[2 * m1] += fx;
        forces[2 * m1 + 1] += fy;
        forces[2 * m2] -= fx;
        forces[2 * m2 + 1] -= fy;
      }

      // Cell contractile forces along the current circumferential direction,
      // which shortens the circumference
      for (const cell of this.cells) {
        const { mass_idx: a, next_idx: b } = cell;
        const tx = current[2 * b] - current[2 * a];
        const ty = current[2 * b + 1] - current[2 * a + 1];
        const len = Math.hypot(tx, ty);
        if (len > 1e-6) {
          cell.orientation = [tx / len, ty / len];
        }

        const fx = cell.force_strength * cell.orientation[0];
        const fy = cell.force_strength * cell.orientation[1];
        forces[2 * a] += fx;
        forces[2 * a + 1] += fy;
        forces[2 * b] -= fx;
        forces[2 * b + 1] -= fy;
      }

      const scale = (subDt * subDt) / this.mass;
      for (let i = 0; i < n; i++) {
        next[i] += forces[i] * scale;
      }

      // Enforce fixed boundary conditions
      for (const idx of this.fixed) {
        next[2 * idx] = current[2 * idx];
        next[2 * idx + 1] = current[2 * idx + 1];
      }

      this.prevPositions = current;
      this.positions = next;
    }
  }

  /** Lumen constriction as a percentage of the starting lumen area. */
  constriction() {
    return ((this.initialArea - this.computeInnerArea()) / this.initialArea) * 100;
  }

  /** Largest distance any node moved in the last substep. */
  maxDisplacement() {
    let max = 0;
    for (let i = 0; i < this.positions.length; i++) {
      max = Math.max(max, Math.abs(this.positions[i] - this.prevPositions[i]));
    }
    return max;
  }

}

// Convert a flat [x0, y0, x1, y1, ...] array to [[x0, y0], [x1, y1], ...]
const toPoints = (flat) => {
  const points = [];
  for (let i = 0; i < flat.length; i += 2) {
    points.push([flat[i], flat[i + 1]]);
  }
  return points;
};

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

// Evenly spaced indices into a list of length n, always keeping the last one
const sampleIndices = (n, max) => {
  if (n <= max) return [...Array(n).keys()];
  return Array.from({ length: max }, (_, i) => Math.round((i * (n - 1)) / (max - 1)));
};

/**
 * Run until the airway stops moving and return the data the UI draws, in the
 * shape the Flask API used. Work is split into short slices so the page stays
 * responsive. Pass keepFrames: false when only the final constriction matters.
 */
export async function runSimulation(params = {}, { keepFrames = true } = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const airway = new CylindricalAirway(p);

  const frames = [airway.positions.slice()];
  const constriction = [0];
  let settled = false;
  let step = 0;
  let sliceStart = performance.now();

  while (step < p.max_steps) {
    airway.stepVerlet(p.dt);
    step += 1;
    if (step % p.save_interval !== 0) continue;

    if (keepFrames) frames.push(airway.positions.slice());
    constriction.push(airway.constriction());

    if (airway.maxDisplacement() < p.settle_tolerance) {
      settled = true;
      break;
    }

    if (performance.now() - sliceStart > SLICE_MS) {
      await yieldToBrowser();
      sliceStart = performance.now();
    }
  }

  const picked = sampleIndices(constriction.length, MAX_FRAMES);

  return {
    positions: keepFrames ? picked.map((i) => toPoints(frames[i])) : [toPoints(airway.positions)],
    constriction: picked.map((i) => constriction[i]),
    final_constriction: constriction[constriction.length - 1],
    settled,
    steps: step,
    initial_area: airway.initialArea,
    num_masses: airway.numMasses,
    num_radial: airway.numRadial,
    num_circum: airway.numCircum,
    springs: airway.springs,
    cells: airway.cells.map(({ mass_idx, force_strength }) => ({ mass_idx, force_strength })),
    fixed_indices: airway.fixed,
  };
}
