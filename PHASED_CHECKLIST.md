# Airway mechanics development checklist

Extend [the mechanics notebook](backend/sim.ipynb) from prescribed contraction
to layer-specific mechanics, parameter comparisons, mesh verification, and
time-dependent muscle kinetics. Keep the existing uniform-stiffness experiments
as a reproducible baseline. Wall parameters are dimensionless and illustrative;
phase 4 uses a separate kinetic clock in seconds with published vascular-muscle
rate constants, without claiming airway calibration.

## Phase 1 Layer-specific stiffness

Status: Complete.

- [x] Give mucosa/submucosa, smooth muscle, cartilage, and adventitia independent
  positive passive spring stiffnesses, with explicit parameter validation.
- [x] Define how radial and diagonal springs combine stiffnesses across tissue
  interfaces; keep muscle activation independent of passive stiffness.
- [x] Preserve the uniform-stiffness baseline and verify force/energy consistency,
  rest stability, boundary constraints, and convergence with heterogeneous layers.
- [x] Add a documented layer configuration and compare its contraction and wall
  displacement with the uniform baseline.
- [x] Execute the notebook, inspect the plots, and record the validation results.

Completion requires an executable notebook in which changing one layer changes
only the associated spring coefficients, while equal layer stiffnesses reproduce
the existing model.

Implemented in notebook section 9 using harmonic interface stiffnesses. The
baseline and layer-specific checks pass, and the uniform baseline is unchanged.
At full activation, the illustrative coefficients 25, 50, 150, and 75
(mucosa, muscle, cartilage, adventitia) give 8.529% lumen narrowing, compared with
10.436% for uniform stiffness 50. The maximum free-node force is below 1e-7 in
both equilibria; halving the heterogeneous model's step changes node positions
by at most 4.57e-12. Interface, input-validation, independence, rest-state, force,
torque, and energy-gradient checks pass.

## Phase 2 Stiffness and activation sweep

Status: Complete.

- [x] Define a tissue-stiffness multiplier and activation grid, stating which
  layers change and which parameters remain fixed.
- [x] Start each run from the same reference geometry and record parameters,
  lumen area, wall displacement, residual force, and convergence status.
- [x] Plot lumen narrowing as a stiffness–activation heatmap and show
  representative airway shapes with comparable axes.
- [x] Flag unconverged or geometrically invalid runs instead of treating them
  as equilibrium results.
- [x] Check zero activation and selected sweep points against independent runs.

Completion requires a reproducible comparison at one stated mesh resolution.
Interpretation across meshes depends on phase 3.

Implemented in notebook section 10 on the 10-ring × 40-sector mesh. Non-muscle
stiffness multipliers 0.25, 0.5, 1, 2, and 4 are combined with activations 0, 0.25,
0.5, 0.75, and 1; passive muscle stiffness remains 50. All 25 cases converge below
a maximum free-node force of 1e-7 and pass the stated geometry checks. At full
activation, narrowing decreases from 17.079% at 0.25× to 4.432% at 4×. All zero
activation cases remain undeformed, the unit multiplier reproduces phase 1, and
three independent half-step checks differ in node position by less than 2e-11.

The phase 2 heatmap and representative shapes have been visually checked. Parameters,
case statuses, geometry diagnostics, displacement profiles, and rerun errors are
saved in [the sweep report](backend/results/phase2_sweep.json). Forced failure
checks confirm that unfinished and invalid cases receive no equilibrium value.
Geometry between saved relaxation frames is not certified.

## Phase 3 Mesh-resolution check

Status: Complete for the continuum reference and its symmetric equilibrium branch.

- [x] Define spatial scaling for passive stiffness, active tension, and applied
  loads; document the limits of simply rescaling the original diagonal springs.
- [x] Hold geometry, tissue thicknesses, activation, and boundary conditions
  physically comparable as resolution changes.
- [x] Compare at least three resolutions, refining radial and circumferential
  directions separately as well as together.
- [x] Compare lumen area, displacement profiles, and solver residuals; distinguish
  discretization error from incomplete relaxation.
- [x] State an acceptance tolerance, document the result, and select a working
  resolution. Revisit phase 2 if scaling changes its conclusions.

Completion requires evidence of convergence under the stated scaling rule;
halving the numerical relaxation step alone does not establish mesh independence.

Section 11 introduces [a continuum solver](backend/continuum.py) because simple
spring rescaling retains aspect-ratio-dependent diagonal coupling. This is an
explicit change to area-integrated bilinear elements with a compressible
neo-Hookean passive law, fixed material interfaces, and integrated active work.
The layer moduli are new illustrative material parameters, not converted spring
coefficients. The legacy spring model and its results remain available; their
mesh independence has not been established.

Four levels per radial, angular, and joint refinement path give 11 distinct
meshes including the working candidate. The finest reference has 80 radial
intervals and 160 sectors. A working mesh of **20 radial intervals, or 21 node
rings, × 80 sectors** passes all three criteria throughout the 25-case grid:

- Narrowing difference: at most 0.004513 percentage points, below 0.05.
- Relative lumen area difference: at most 0.077632%, below 0.1%.
- Radial displacement difference: at most 0.000081769, below 0.0002.

The solver checks full two-dimensional free-node force density below 1e-7.
Tightening this to 1e-8 on the working baseline changes narrowing by only
5.02e-10 percentage points. Eight independent continuum verification tests pass;
the two phase 3 figures are saved and inspected.
Evidence is recorded in [the convergence report](backend/results/phase3_mesh_convergence.json).

The continuum revisit retains the stiffness–narrowing trend but changes the
predictions: at full activation, narrowing ranges from 13.865% at the 0.25×
multiplier to 2.945% at 4×. This change includes the new constitutive assumptions
and is not a pure mesh correction to phase 2. The study covers the symmetric
branch, not buckling or stability against nonsymmetric perturbations.

## Phase 4 Time-dependent muscle kinetics

Status: Complete for the four-state kinetics and illustrative quasistatic coupling.

- [x] Review the Hai–Murphy source and specify state variables, transition rates,
  activation input, parameter provenance, and units.
- [x] Implement the kinetic equations and verify state nonnegativity and
  conservation of the total cross-bridge population.
- [x] Define and document how cross-bridge states produce muscle tension.
- [x] Choose and validate the coupling between kinetic time and wall mechanics;
  do not interpret numerical relaxation time as physiological time.
- [x] Simulate activation and relaxation protocols, checking limiting cases and
  time-step sensitivity.
- [x] Compare with a stated reference or dataset and separate verified model
  behaviour from parameters that still need calibration.

Completion requires validated kinetics and mechanical coupling, with time courses
of cross-bridge states, muscle tension, and lumen narrowing.

Section 12 uses [the kinetic module](backend/hai_murphy.py) to implement the
four-state scheme and rate constants on pp. C86–C87 of
[Hai and Murphy (1988)](https://doi.org/10.1152/ajpcell.1988.255.1.C86).
The rate constants come from vascular-muscle experiments, while the kinase-input
protocol and wall parameters are illustrative. Kinetic time is in seconds;
mechanical quantities remain dimensionless. Both attached states contribute
equally to active tension, and each time sample drives a fresh continuum
equilibrium. Newton iterations have no assigned physiological duration.

The matrix-exponential solution splits at every input switch. Nine kinetic and
coupling tests verify individual transitions, population conservation, exact
limiting cases, an independent adaptive solver, published steady-state equations,
input validation, and rejection of unfinished wall solves. The transient
population sum error is below 1.94e-14 and its minimum population is zero.
The published apparent-rate equations agree within 5.56e-17 per second. An
independent RK4 calculation reduces maximum population error from 4.44e-4 at
0.5 s steps to 6.67e-8 at 0.0625 s steps.

All **993 wall snapshots** pass the 1e-7 force-density tolerance and geometry
checks. The coarser-output interpolation differs by at most **0.024663 percentage
points**, below the 0.05 criterion. Independent shared-time solves agree in
radius within 4.45e-16, and peak/sustained/relaxation snapshots pass the finest-mesh
comparison. The sampled peak narrowing is **4.087249% at 30.5 s**, falling to
**0.029795% at 600 s** after withdrawal at 120 s. The late tension tail has the
expected 100 s decay timescale for the chosen latch-detachment rate.

Rates, provenance, protocol, time courses, wall profiles, convergence diagnostics,
and reference/refinement comparisons are saved in
[the kinetics report](backend/results/phase4_kinetics.json). The complete notebook
executes all **29 code cells** without errors, runs **17 standalone verification
tests**, and saves **11 plots**. The new reference and time-course figures have
been visually checked.

All four phases are complete within these stated limits. The coupling assumes
instantaneous mechanical equilibration and omits viscous delay, strain feedback,
and the paper's Huxley force–velocity extension. Neither the vascular rates nor
the dimensionless wall parameters are an airway calibration. The symmetric-branch
and legacy-spring mesh limitations from phase 3 still apply.

## Browser companion alignment

Status: Complete. The browser implements the final model in notebook sections
11–12; the earlier spring sections remain developmental background.

- [x] Replace the browser's legacy Verlet springs with the same continuum energy,
  tissue interfaces, layer moduli, quadrature, and force-density acceptance rule.
- [x] Port the four-state kinetics, reference rates, protocol, and all 993 output
  times, keeping numerical equilibrium iterations separate from kinetic seconds.
- [x] Provide kinetic and prescribed-activation modes, independent tissue controls,
  the non-muscle stiffness sweep, time-course plots, and JSON results export.
- [x] Compare every notebook refinement mesh, all 25 continuum sweep cases, and
  all 993 kinetic states and wall profiles against the Python results. Verify
  additional material, geometry, rate, and off-grid-switch cases independently.
- [x] Check the production worker, playback and seeking, zero activation, parameter
  changes, cancellation/restart, exports, and desktop/mobile light/dark layouts.
- [x] Update the README and notebook to explain the shared model and parity workflow.

The browser's 11 verification tests pass. Their tolerances are 2e-12 for kinetic
fractions, 2e-9 for radii, and 2e-7 percentage points for narrowing. Default full
prescribed activation gives 5.350553% narrowing; the kinetic protocol reproduces
the 4.087249% peak at 30.5 s. The production build succeeds, and the headless
browser interaction check reports no runtime exceptions. All numerical work runs
in a browser worker without a Python service. The reference equations and
calibration limits above are unchanged.
