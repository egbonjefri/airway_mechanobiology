"""Verification of the continuum wall: energy, forces, quadrature, and equilibrium solver."""

import unittest
import numpy as np

try:
    from .continuum import ContinuumAirway
except ImportError:  # Notebook launched directly in backend/.
    from continuum import ContinuumAirway


class ContinuumTests(unittest.TestCase):
    def test_reference_and_rigid_motion(self):
        model = ContinuumAirway(10, 20, activation=0)
        energy, forces, minimum_j = model.energy_forces(model.reference)
        self.assertLess(abs(energy), 1e-11)
        np.testing.assert_allclose(forces, 0, atol=1e-11)
        self.assertAlmostEqual(minimum_j, 1)
        angle = 0.37
        rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
        transformed = model.reference @ rotation.T + [0.23, -0.17]
        energy, forces, _ = model.energy_forces(transformed)
        self.assertLess(abs(energy), 1e-11)
        np.testing.assert_allclose(forces, 0, atol=1e-11)

    def test_objectivity_with_active_tension(self):
        model = ContinuumAirway(10, 20, activation=0.6)
        x = model.reference @ np.diag([0.97, 1.02])
        angle = 0.4
        rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
        e1, f1, _ = model.energy_forces(x)
        e2, f2, _ = model.energy_forces(x @ rotation.T + [0.2, 0.1])
        self.assertAlmostEqual(e1, e2, places=10)
        np.testing.assert_allclose(f2, f1 @ rotation.T, rtol=1e-10, atol=1e-11)

    def test_full_force_gradient_balance_and_torque(self):
        model = ContinuumAirway(10, 20, activation=0.6, radial_traction=0.1)
        rng = np.random.default_rng(9)
        x = model.reference + rng.normal(scale=0.001, size=model.reference.shape)
        direction = rng.normal(size=x.shape)
        direction /= np.linalg.norm(direction)
        epsilon = 1e-6
        derivative = (model.state(x + epsilon * direction)[0] - model.state(x - epsilon * direction)[0]) / (2 * epsilon)
        _, forces, _ = model.energy_forces(x)
        np.testing.assert_allclose(derivative, -np.sum(forces * direction), rtol=1e-6, atol=1e-7)
        internal = forces - model.external
        np.testing.assert_allclose(internal.sum(axis=0), 0, atol=1e-11)
        torque = np.sum(x[:, 0] * internal[:, 1] - x[:, 1] * internal[:, 0])
        self.assertLess(abs(torque), 1e-10)

    def test_radial_gradient_and_tangent(self):
        model = ContinuumAirway(10, 20, activation=0.8, radial_traction=0.03)
        radii = model.reference_radii - 0.01 * (model.outer_radius - model.reference_radii)
        _, gradient, hessian = model.radial_system(radii)
        _, forces, _ = model.energy_forces(model.radial_positions(radii))
        expected = -np.sum(forces.reshape(-1, model.sectors, 2) * model.directions[None], axis=(1, 2))
        np.testing.assert_allclose(gradient, expected, rtol=1e-10, atol=1e-10)
        np.testing.assert_allclose(hessian, hessian.T, rtol=1e-12, atol=1e-10)
        direction = np.random.default_rng(1).normal(size=len(radii))
        direction /= np.linalg.norm(direction)
        epsilon = 1e-6
        numerical = (model.radial_system(radii + epsilon * direction)[1]
                     - model.radial_system(radii - epsilon * direction)[1]) / (2 * epsilon)
        np.testing.assert_allclose(numerical, hessian @ direction, rtol=1e-6, atol=1e-5)

    def test_area_material_and_load_scaling(self):
        for nr, nc in [(10, 20), (20, 40), (40, 80)]:
            model = ContinuumAirway(nr, nc, radial_traction=0.3)
            boundaries = np.array([1, 1.2, 1.5, 1.8, 2])
            factor = nc * np.sin(2 * np.pi / nc) / 2
            for layer in range(4):
                area = model.weights[model.layer_indices == layer].sum()
                self.assertAlmostEqual(area, factor * (boundaries[layer + 1] ** 2 - boundaries[layer] ** 2), places=11)
            self.assertAlmostEqual(model.node_areas.sum(), model.weights.sum(), places=11)
            self.assertAlmostEqual(np.linalg.norm(model.external, axis=1).sum(), 0.3 * 2 * nc * np.sin(np.pi / nc), places=11)
            muscle_area = model.weights[model.layer_indices == 1].sum()
            self.assertAlmostEqual(np.sum(model.weights * model.tension_density) / muscle_area, 20, places=11)

    def test_affine_energy_matches_density(self):
        young, nu = 50.0, 0.25
        model = ContinuumAirway(10, 20, moduli={key: young for key in ContinuumAirway.TISSUES}, activation=0)
        deformation = np.array([[1.03, 0.02], [0.01, 0.97]])
        mu = young / (2 * (1 + nu))
        lame = young * nu / ((1 + nu) * (1 - 2 * nu))
        log_j = np.log(np.linalg.det(deformation))
        density = mu / 2 * (np.sum(deformation ** 2) - 2) - mu * log_j + lame / 2 * log_j ** 2
        energy, _, _ = model.energy_forces(model.reference @ deformation.T)
        self.assertAlmostEqual(energy, model.weights.sum() * density, places=10)

    def test_equilibrium_and_unfinished_exit(self):
        model = ContinuumAirway(10, 20)
        unfinished = model.solve(max_iterations=0)
        self.assertFalse(unfinished["converged"])
        result = model.solve()
        self.assertTrue(result["converged"])
        self.assertLessEqual(result["residual_density"], 1e-7)
        self.assertGreater(result["narrowing_percent"], 0)
        np.testing.assert_array_equal(result["positions"][model.fixed], model.reference[model.fixed])
        self.assertGreater(np.diff(result["radii"]).min(), 0)
        self.assertGreater(result["minimum_jacobian"], 0)
        self.assertLessEqual(np.max(np.diff([item["potential"] for item in result["history"]])), 1e-10)
        unloaded = ContinuumAirway(10, 20, activation=0).solve()
        self.assertTrue(unloaded["converged"])
        self.assertEqual(unloaded["iterations"], 0)
        self.assertEqual(unloaded["narrowing_percent"], 0)

    def test_invalid_geometry_and_configuration(self):
        for kwargs in ({"radial_intervals": 9}, {"sectors": 2}, {"poisson_ratio": 0.5},
                       {"activation": 2}, {"active_stress": -1}, {"moduli": {"muscle": 50}}):
            with self.assertRaises(ValueError):
                ContinuumAirway(**kwargs)
        model = ContinuumAirway(10, 20)
        with self.assertRaises(ValueError):
            model.state(model.reference @ np.diag([-1, 1]))


if __name__ == "__main__":
    unittest.main()
