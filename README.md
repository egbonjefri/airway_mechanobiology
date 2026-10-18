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

Choose **Run model** to simulate the default activation–relaxation protocol.
Playback and the time slider (or clicking and dragging directly on any time-course chart)
use kinetic seconds. A single focused chart is shown below the controls: use its selector
to switch between time-course views (**Lumen narrowing**, **Muscle tension**, **Cross-bridges**,
**Kinase input**) and radial wall profiles across the four tissue layers at the selected time
(**Wall displacement**, **Wall stretch**, **Wall stress**). **Pin run** overlays a reference
run on the active chart for direct comparison; **Export JSON** saves parameters, units,
convergence diagnostics, populations, and radial profiles for every accepted time.

The airway illustration magnifies radial displacement up to 10× by default, with
the scale shown below it. One factor applies to the entire run; larger contractions
use a smaller factor to keep the displayed lumen and layers readable. **View & mesh**
includes a true-scale option, mesh overlay, and optional 2D non-axisymmetric cartilage
plate segmentation and mucosal folding. The wall is drawn as an illustrative section in the
colours of a Movat pentachrome stain, painted once in the resting geometry and
warped by the solved displacement with WebGL, so every layer stretches as
the model wall does. Playback interpolates the drawing between accepted equilibria;
percentages, plots, and exported radii always retain the actual model values.

Open **Tissue stiffness** and choose **Compare tissue stiffness** to compute the
stiffness–activation sweep across the five non-muscle stiffness multipliers ($0.25\times$ to $4\times$).
Calculations can be cancelled; unfinished or geometrically invalid equilibria are never presented as results.

## Shared model

- **Geometry & boundary conditions:** inner radius 1, outer radius 2, with tissue interfaces at 1.2,
  1.5, and 1.8. The default mesh has 20 radial intervals (21 node rings) and 80
  angular sectors. By default the outer boundary is fixed and the lumen boundary is free;
  optional lumen radial traction and elastic outer-boundary parenchymal tethering ($k > 0$)
  can be adjusted in the UI.
- **Passive wall:** compressible neo-Hookean material in plane strain, default Poisson
  ratio 0.25, bilinear quadrilaterals, and 2×2 Gauss integration. Default moduli
  are 25, 50, 150, and 75 for mucosa/submucosa, muscle, schematic cartilage, and
  adventitia. Each layer has an independent control. A separate multiplier
  scales the three non-muscle moduli while keeping passive muscle stiffness fixed.
- **Muscle tension:** nominal active tension density is `20 × (AMp + AM)` in
  kinetic mode, or `20 × activation` in prescribed mode. The scale 20 can be
  adjusted. Active work is integrated over the muscle layer, not assigned as a
  fixed force to each mesh node.
- **Kinetics & optional strain feedback:** the states are detached dephosphorylated `M`, detached
  phosphorylated `Mp`, attached phosphorylated `AMp`, and attached latch `AM`.
  Default rates in s⁻¹ are `k2 = k5 = 0.5`, `k3 = 0.4`, `k4 = 0.1`, and `k7 = 0.01`,
  all adjustable in the UI. The prescribed input `k1 = k6` is 0 before 10 s, 0.55 from 10–30 s,
  0.10 from 30–120 s, then zero. Setting **Strain feedback $\gamma > 0$** enables two-way
  mechanochemical coupling (strain-accelerated latch detachment and filament-overlap tension modulation).
- **Coupling:** solve a wall equilibrium at each kinetic output time. Require free-node
  force density below `1e-7`, positive element Jacobians, and ordered positive radii.

Mechanical geometry, moduli, and tension are **dimensionless and illustrative**.
The kinetic clock is in seconds. The rate reference is
[Hai and Murphy (1988), pp. C86–C87](https://doi.org/10.1152/ajpcell.1988.255.1.C86),
whose rates were fitted to swine carotid muscle. This is not an airway calibration.

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
outer boundary tethering, radial wall profiles, 2D asymmetric cartilage/folding,
rates, steady states, two-way strain feedback, initial populations, and off-grid switches,
including energy, gradient, tangent, and full nodal force density. Tests also cover isolated
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
validation. The notebook's mesh study uses the default parameters; custom
parameters still require interpretation within the model's limits.

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

Choose **Restart Kernel and Run All Cells**; the run takes a few minutes. The
notebook states the model, checks mesh convergence and the kinetics against Hai and
Murphy's published steady-state equations, and reports the activation–relaxation
time course and the stiffness–activation sweep. It saves the reference results used
by the browser tests to [`backend/results/`](backend/results): `mesh_convergence.json`,
`stiffness_sweep.json`, and `time_course.json`.

## Deployment

`netlify.toml` builds `frontend/` with `npm run build` and publishes
`frontend/build`. The worker is bundled as a static asset, so hosting needs no
simulation service.
