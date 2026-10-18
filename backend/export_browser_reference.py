"""Regenerate independent Python fixtures for the browser's numerical parity tests.

Run from the repository root: python -m backend.export_browser_reference
The notebook's saved reports in results/ provide the main reference grids; this
fixture adds non-default geometry, materials, rates, and off-grid input switches.
"""
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path

import numpy as np

from .continuum import ContinuumAirway
from .hai_murphy import ActivationProtocol, HaiMurphyRates, simulate, coupled_response


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
        {"radial_intervals": 20, "sectors": 40, "moduli": {"mucosa": 25, "muscle": 50, "cartilage": 150, "adventitia": 75},
         "poisson_ratio": .25, "active_stress": 20.0, "activation": .75, "radial_traction": -.15, "outer_stiffness": 35.0},
    ]
    mapping = {"radial_intervals": "radialIntervals", "sectors": "sectors", "moduli": "moduli",
               "poisson_ratio": "poissonRatio", "active_stress": "activeStress",
               "inner_radius": "innerRadius", "outer_radius": "outerRadius",
               "radial_traction": "radialTraction", "outer_stiffness": "outerStiffness"}
    for kwargs in settings:
        model = ContinuumAirway(**kwargs)
        radii = model.reference_radii - .017 * (model.outer_radius - model.reference_radii) ** 2
        if model.outer_stiffness is not None:
            radii[-1] -= 0.008
        energy, gradient, hessian = model.radial_system(radii)
        _, forces, min_j = model.energy_forces(model.radial_positions(radii))
        density = np.linalg.norm(forces[~model.fixed], axis=1) / model.node_areas[~model.fixed]
        solved = model.solve()
        assert solved["converged"]
        profile = model.wall_profile(solved["radii"], kwargs["activation"])
        report["wall_cases"].append({
            "parameters": {mapping[key]: value for key, value in kwargs.items() if key != "activation"},
            "activation": kwargs["activation"], "probe_radii": radii.tolist(),
            "probe_energy": energy, "probe_gradient": gradient.tolist(), "probe_hessian": hessian.tolist(),
            "probe_residual_density": float(density.max()), "probe_minimum_jacobian": min_j,
            "equilibrium_radii": solved["radii"].tolist(), "narrowing_percent": solved["narrowing_percent"],
            "profile": {
                "displacement": profile["displacement"].tolist(),
                "radial_stretch": profile["radial_stretch"].tolist(),
                "hoop_stretch": profile["hoop_stretch"].tolist(),
                "radial_stress": profile["radial_stress"].tolist(),
                "hoop_stress": profile["hoop_stress"].tolist(),
                "muscle_stretch": profile["muscle_stretch"],
            },
        })
    asym_wall = ContinuumAirway(20, 40, activation=0.85, outer_stiffness=50.0)
    asym_solved = asym_wall.solve_asymmetric(cartilage_gap=0.5, cartilage_plates=4, mucosal_folding=0.3, mucosal_folds=8)
    report["asymmetric_case"] = {
        "parameters": {"radialIntervals": 20, "sectors": 40, "outerStiffness": 50.0},
        "activation": 0.85,
        "options": {"cartilageGap": 0.5, "cartilagePlates": 4, "mucosalFolding": 0.3, "mucosalFolds": 8},
        "radii": asym_solved["radii"].tolist(),
        "sector_radii": asym_solved["sector_radii"].tolist(),
        "lumen_area": asym_solved["lumen_area"],
        "narrowing_percent": asym_solved["narrowing_percent"],
    }
    protocol = ActivationProtocol((0, .37, 8.21, 80.6), (.03, .71, .12, 0))
    rates = HaiMurphyRates(k2=.65, k3=.42, k4=.17, k5=.32, k7=.023)
    initial = [.12, .18, .3, .4]
    times = [0, .1, .37, .45, 1, 8.21, 8.22, 15, 80.6, 81, 210, 600]
    report["kinetic_case"] = {
        "protocol": {"switchTimes": protocol.switch_times, "kinaseRates": protocol.kinase_rates},
        "rates": asdict(rates), "initial": initial, "times": times,
        "states": simulate(times, protocol, rates=rates, initial=initial).tolist(),
        "steady_state_071": rates.steady_state(0.71).tolist(),
    }
    coupled_times = [0, 10, 20, 30, 60, 120, 300, 600]
    coupled_proto = ActivationProtocol((0, 10, 30, 120), (0, 0.55, 0.10, 0))
    coupled = coupled_response(
        coupled_times, coupled_proto, strain_feedback=0.8,
        radial_intervals=10, sectors=24, outer_stiffness=40.0)
    report["coupled_case"] = {
        "times": coupled_times,
        "strain_feedback": 0.8,
        "radial_intervals": 10,
        "sectors": 24,
        "outer_stiffness": 40.0,
        "states": coupled["states"].tolist(),
        "radii": coupled["radii"].tolist(),
        "narrowing_percent": coupled["narrowing_percent"].tolist(),
        "tension_density": coupled["tension_density"].tolist(),
    }
    output = root / "frontend" / "tests" / "python-reference.json"
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(f"Saved {output}")


if __name__ == "__main__":
    export()
