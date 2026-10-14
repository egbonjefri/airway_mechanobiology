# Airway Smooth Muscle Contraction Simulator

A browser app that models a cross-section of the airway wall as a mass-spring
network and shows how far contracting airway smooth muscle (ASM) narrows the
lumen at different tissue stiffnesses. Everything runs in the browser; there is
no server.

## The model

- **Geometry.** The wall is an annulus of point masses in concentric rings
  (8 radial × 24 circumferential by default), with inner radius 1 and outer
  radius 2.
- **Springs.** Circumferential and radial springs have stiffness *k*. Two
  diagonal springs per element resist shear, at *k*/2.
- **Muscle.** ASM cells sit in the middle ring. Each one pulls on its neighbour
  along the current circumferential direction with a constant force, which
  shortens the ring.
- **Boundary.** The outer ring is fixed, standing in for the tissue around the
  airway.
- **Integration.** Damped Verlet with 5 substeps per step. A run stops once no
  node moves more than 1e-8 in a substep.
- **Output.** Lumen constriction is the percentage drop in the area enclosed by
  the innermost ring (shoelace formula).

All quantities are dimensionless, and the parameters are not fitted to tissue
data.

## What it shows, and what it doesn't yet

Every spring has the same stiffness, and the cells pull with the same force
whatever the stiffness. So the steady-state narrowing is set by the ratio of
cell force to stiffness: halve *k* or double the force and the lumen narrows
about twice as much. At the default settings (*k* = 50, force = 2) the lumen
narrows by about 1.5%. The result also depends on mesh resolution, because each
spring keeps the same *k* however short it is.

The mechanobiology is the next step:

- Cells that sense local stiffness and change their force in response.
- Separate stiffness for the extracellular matrix and the muscle layer, or
  stiffness gradients and patches.
- Cross-bridge kinetics for the muscle force, such as the Hai–Murphy
  latch-bridge model.
- A layered wall (mucosa, smooth muscle, cartilage, adventitia), as sketched in
  `backend/sim.ipynb`.

## Running locally

```sh
cd frontend
npm install
npm start
```

The app opens at http://localhost:3000.

## Python version

`backend/simulation.py` is the original NumPy implementation, and
`frontend/src/simulation.js` ports its physics line for line. The port runs
until the airway settles instead of for a fixed 1000 steps; at the default
settings, 1000 steps of the original reach 0.33% constriction against a steady
state of 1.46%. It also uses a larger time step (0.1 instead of 0.01), which
reaches the same steady state in far fewer steps.

`backend/app.py` serves the Python model through a small Flask API
(`POST /api/simulate`, `GET /api/parameters`). The web app no longer uses it.

```sh
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Deployment

`netlify.toml` builds `frontend/` with `npm run build` and publishes
`frontend/build`.
