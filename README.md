# Airway Smooth Muscle Contraction Simulator

An interactive airway-wall model accompanied by [the mechanics notebook](backend/sim.ipynb).
The browser implements the notebook's final model: a four-layer continuum wall
with either prescribed activation or Hai–Murphy cross-bridge kinetics. Everything
runs locally in a browser worker; the app needs no Python server.

## Run the app

```sh
cd frontend
npm install
npm start
```

Select **Reset defaults**, then **Run model**, to reproduce the notebook's
activation and relaxation protocol. Playback and the time slider use kinetic
seconds. Use the time-course selector to view lumen narrowing, tension, all four
cross-bridge states, or the kinase input. **Export JSON** saves the parameters, units,
convergence diagnostics, populations, and radial profiles for every accepted time.

The airway illustration magnifies radial displacement up to 10× by default, with
the scale shown below it. One factor applies to the entire run; larger contractions
use a smaller factor to keep the displayed lumen and layers readable. **View & mesh**
includes a true-scale option. The wall is drawn as an illustrative section in the
colours of a Movat pentachrome stain, painted once in the resting geometry and
warped by the solved displacement with WebGL, so every layer stretches exactly as
the model wall does. Playback interpolates the drawing between accepted equilibria;
percentages, plots, and exported radii always retain the actual model values.

Select **Prescribed activation** for a static equilibrium, then open **Tissue
stiffness** and choose **Compare tissue stiffness** to reproduce the five non-muscle stiffness multipliers. Changing any
parameter clears previous results and comparisons. Calculations can be cancelled;
unfinished or geometrically invalid equilibria are never presented as results.

## Shared model

- **Geometry:** inner radius 1, outer radius 2, with tissue interfaces at 1.2,
  1.5, and 1.8. The default mesh has 20 radial intervals (21 node rings) and 80
  angular sectors. The outer boundary is fixed; the lumen boundary is free.
- **Passive wall:** compressible neo-Hookean material in plane strain, Poisson
  ratio 0.25, bilinear quadrilaterals, and 2×2 Gauss integration. Default moduli
  are 25, 50, 150, and 75 for mucosa/submucosa, muscle, schematic cartilage, and
  adventitia. Each layer has an independent control. A separate multiplier
  scales the three non-muscle moduli while keeping passive muscle stiffness fixed.
- **Muscle tension:** nominal active tension density is `20 × (AMp + AM)` in
  kinetic mode, or `20 × activation` in prescribed mode. The scale 20 can be
  adjusted. Active work is integrated over the muscle layer, not assigned as a
  fixed force to each mesh node.
- **Kinetics:** the states are detached dephosphorylated `M`, detached
  phosphorylated `Mp`, attached phosphorylated `AMp`, and attached latch `AM`.
  Rates in s⁻¹ are `k2 = k5 = 0.5`, `k3 = 0.4`, `k4 = 0.1`, and `k7 = 0.01`.
  The prescribed input `k1 = k6` is 0 before 10 s, 0.55 from 10–30 s, 0.10 from
  30–120 s, then zero. These defaults match notebook section 12.
- **Coupling:** solve a fresh rotationally symmetric wall equilibrium at each
  kinetic output time. Require free-node force density below `1e-7`, positive
  element Jacobians, ordered positive radii, and the fixed outer boundary.
  Newton iterations have no duration in seconds.

Mechanical geometry, moduli, and tension are **dimensionless and illustrative**.
The kinetic clock is in seconds. The rate reference is
[Hai and Murphy (1988), pp. C86–C87](https://doi.org/10.1152/ajpcell.1988.255.1.C86),
whose rates were fitted to swine carotid muscle. This is not an airway calibration.
The coupling assumes rapid mechanical equilibration and omits viscous delay,
strain feedback, and the paper's Huxley force–velocity extension. The symmetric
branch does not establish stability against asymmetric collapse.

## Browser–Python agreement

The Python reference implementations are [continuum.py](backend/continuum.py)
and [hai_murphy.py](backend/hai_murphy.py). Their browser counterparts are
[continuum.js](frontend/src/model/continuum.js) and
[kinetics.js](frontend/src/model/kinetics.js), coordinated by
[simulation.js](frontend/src/simulation.js).

The browser integrates one representative angular sector and uses rotational
symmetry to assemble the full energy, radial gradient/tangent, and two-dimensional
nodal force density. It uses the same quadrature and constitutive law as Python.
The kinetic matrix exponential uses uniformization with scaling and squaring;
it splits at every input switch, including switches absent from the output grid.
Populations are not clipped or renormalized.

Run the browser parity suite from `frontend/`:

```sh
npm test
npm run build
```

The tests compare all 11 notebook refinement meshes, all 25 continuum sweep
cases, and every kinetic population and wall profile in the 993-sample default
time course. Additional independent Python fixtures cover changed materials,
geometry, rates, initial populations, and off-grid switches, including energy,
gradient, tangent, and full nodal force density. Tests also cover isolated
transitions, zero input/tension, invalid inputs, and failed equilibrium solves.

Reference checks at notebook defaults:

| Experiment | Lumen narrowing |
|---|---:|
| Full prescribed activation | 5.350553% |
| Kinetic peak at 30.5 s | 4.087249% |
| Kinetic result at 600 s | 0.029795% |

The test tolerances for browser–Python agreement are `2e-12` for kinetic
fractions, `2e-9` for radii, and `2e-7` percentage points for narrowing. These
implementation checks are distinct from spatial convergence and biological
validation. The notebook's accepted working mesh applies to its stated parameter
grid; custom parameters still require interpretation within the model's limits.

After changing the Python model, rerun the notebook and regenerate the custom
fixtures from the repository root:

```sh
python -m backend.export_browser_reference
```

Fixture source hashes detect changes to the Python reference modules. Saved
notebook reports, rather than browser-generated values, supply the main regression
references.

## Companion notebook

From the repository root, using your Python environment:

```sh
python -m pip install -r backend/requirements-notebook.txt
python -m jupyterlab backend/sim.ipynb
python -m unittest backend.test_continuum backend.test_hai_murphy -v
```

Choose **Restart Kernel and Run All Cells**; the full run takes several minutes.
All four phases are tracked in [PHASED_CHECKLIST.md](PHASED_CHECKLIST.md).

The notebook first develops a spring network and verifies passive forces,
shear resistance, prescribed contraction, and layer-specific spring stiffnesses.
Those sections provide the developmental background. Section 10 saves the legacy
spring sweep to [phase2_sweep.json](backend/results/phase2_sweep.json).

**Section 11** introduces the continuum formulation used by the browser, defines
spatial scaling and fixed tissue interfaces, and checks radial, angular, and joint
refinement. It also revisits the stiffness–activation sweep. Evidence is saved to
[phase3_mesh_convergence.json](backend/results/phase3_mesh_convergence.json).
This explicit constitutive change does not establish mesh independence of the
original spring network.

**Section 12** supplies the browser's kinetic model, rate provenance, protocol,
and quasistatic coupling. It verifies nonnegativity, conservation, analytic limits,
published steady-state equations, an independent ODE solver, temporal refinement,
and selected finer spatial meshes. Trajectories and evidence are saved to
[phase4_kinetics.json](backend/results/phase4_kinetics.json). The executed notebook
contains 29 code cells and 11 plots, with 17 standalone Python verification tests.

## Legacy implementation

`backend/simulation.py` retains the original uniform-spring Verlet model.
`backend/app.py` exposes that legacy model through Flask; it is **not** the
reference for the current browser app. The app does not call that API.

## Deployment

`netlify.toml` builds `frontend/` with `npm run build` and publishes
`frontend/build`. The worker is bundled as a static asset, so hosting needs no
simulation service.
