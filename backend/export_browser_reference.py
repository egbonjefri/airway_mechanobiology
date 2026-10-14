"""Regenerate independent Python fixtures for the browser's numerical parity tests.

Run from the repository root: python -m backend.export_browser_reference
The notebook's saved phase 3/4 reports provide the main reference grids; this
fixture adds non-default geometry, materials, rates, and off-grid input switches.
"""
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path

import numpy as np

from .continuum import ContinuumAirway
from .hai_murphy import ActivationProtocol, HaiMurphyRates, simulate


def export():
    root = Path(__file__).resolve().parent.parent
    report = {
        "source_sha256": {name: sha256((root / "backend" / name).read_bytes()).hexdigest()
                          for name in ("continuum.py", "hai_murphy.py")},
        "wall_cases": [],
    }
    settings = [
        {"radial_intervals": 10, "sectors": 40, "moduli": {"mucosa": 17, "muscle": 83, "cartilage": 212, "adventitia": 61},
         "poisson_ratio": .35, "active_stress": 12.3, "activation": .37, "radial_traction": .07},
        {"radial_intervals": 30, "sectors": 48, "inner_radius": .7, "outer_radius": 2.3,
         "poisson_ratio": .1, "active_stress": 7.2, "activation": .81},
    ]
    mapping = {"radial_intervals": "radialIntervals", "sectors": "sectors", "moduli": "moduli",
               "poisson_ratio": "poissonRatio", "active_stress": "activeStress",
               "inner_radius": "innerRadius", "outer_radius": "outerRadius", "radial_traction": "radialTraction"}
    for kwargs in settings:
        model = ContinuumAirway(**kwargs)
        radii = model.reference_radii - .017 * (model.outer_radius - model.reference_radii) ** 2
        energy, gradient, hessian = model.radial_system(radii)
        _, forces, min_j = model.energy_forces(model.radial_positions(radii))
        density = np.linalg.norm(forces[~model.fixed], axis=1) / model.node_areas[~model.fixed]
        solved = model.solve()
        assert solved["converged"]
        report["wall_cases"].append({
            "parameters": {mapping[key]: value for key, value in kwargs.items() if key != "activation"},
            "activation": kwargs["activation"], "probe_radii": radii.tolist(),
            "probe_energy": energy, "probe_gradient": gradient.tolist(), "probe_hessian": hessian.tolist(),
            "probe_residual_density": float(density.max()), "probe_minimum_jacobian": min_j,
            "equilibrium_radii": solved["radii"].tolist(), "narrowing_percent": solved["narrowing_percent"],
        })
    protocol = ActivationProtocol((0, .37, 8.21, 80.6), (.03, .71, .12, 0))
    rates = HaiMurphyRates(k2=.65, k3=.42, k4=.17, k5=.32, k7=.023)
    initial = [.12, .18, .3, .4]
    times = [0, .1, .37, .45, 1, 8.21, 8.22, 15, 80.6, 81, 210, 600]
    report["kinetic_case"] = {
        "protocol": {"switchTimes": protocol.switch_times, "kinaseRates": protocol.kinase_rates},
        "rates": asdict(rates), "initial": initial, "times": times,
        "states": simulate(times, protocol, rates=rates, initial=initial).tolist(),
    }
    output = root / "frontend" / "tests" / "python-reference.json"
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(f"Saved {output}")


if __name__ == "__main__":
    export()
