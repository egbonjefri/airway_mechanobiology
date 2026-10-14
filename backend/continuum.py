"""Area-integrated annular reference model for the notebook's mesh study.

The legacy central-spring model is retained in sim.ipynb. This model instead
uses bilinear quadrilaterals and a compressible neo-Hookean plane-strain energy.
Its equilibrium solver follows the rotationally symmetric branch only, and
checks the full two-dimensional free-node force density before accepting a run.
"""

import numpy as np


class ContinuumAirway:
    TISSUES = ("mucosa", "muscle", "cartilage", "adventitia")
    INTERFACES = np.array([0.2, 0.5, 0.8])

    def __init__(self, radial_intervals=20, sectors=80, *, moduli=None,
                 poisson_ratio=0.25, active_stress=20.0, activation=1.0,
                 inner_radius=1.0, outer_radius=2.0, radial_traction=0.0):
        if (isinstance(radial_intervals, (bool, np.bool_))
                or not isinstance(radial_intervals, (int, np.integer))
                or radial_intervals < 10 or radial_intervals % 10):
            raise ValueError("radial_intervals must be a positive multiple of 10 to resolve every interface.")
        if isinstance(sectors, (bool, np.bool_)) or not isinstance(sectors, (int, np.integer)) or sectors < 8:
            raise ValueError("sectors must be an integer >= 8.")
        if not np.isfinite([poisson_ratio, active_stress, activation, inner_radius, outer_radius, radial_traction]).all():
            raise ValueError("Material and load parameters must be finite.")
        if not -1 < poisson_ratio < 0.5 or active_stress < 0 or not 0 <= activation <= 1:
            raise ValueError("Require -1 < nu < 0.5, active_stress >= 0, and 0 <= activation <= 1.")
        if not 0 < inner_radius < outer_radius:
            raise ValueError("Require 0 < inner_radius < outer_radius.")
        if moduli is None:
            moduli = dict(zip(self.TISSUES, [25.0, 50.0, 150.0, 75.0]))
        if not isinstance(moduli, dict) or set(moduli) != set(self.TISSUES):
            raise ValueError("Specify all four layer moduli.")
        values = np.asarray([moduli[key] for key in self.TISSUES], dtype=float)
        if not np.isfinite(values).all() or np.any(values <= 0):
            raise ValueError("Layer moduli must be finite and positive.")
        self.moduli = dict(zip(self.TISSUES, values.tolist()))
        self.radial_intervals, self.sectors = int(radial_intervals), int(sectors)
        self.inner_radius, self.outer_radius = float(inner_radius), float(outer_radius)
        self.poisson_ratio = float(poisson_ratio)
        self.active_stress, self.activation = float(active_stress), float(activation)
        self.radial_traction = float(radial_traction)
        self.reference_radii = np.linspace(inner_radius, outer_radius, radial_intervals + 1)
        angles = np.arange(sectors) * (2 * np.pi / sectors)
        self.directions = np.column_stack((np.cos(angles), np.sin(angles)))
        self.reference = self.radial_positions(self.reference_radii)
        self.radii = self.reference_radii.copy()
        grid = np.arange(len(self.reference)).reshape(radial_intervals + 1, sectors)
        self.elements = np.stack([grid[:-1], grid[1:], np.roll(grid[1:], -1, axis=1),
                                  np.roll(grid[:-1], -1, axis=1)], axis=-1).reshape(-1, 4)
        self.element_rings = np.repeat(np.arange(radial_intervals), sectors)
        midpoint_fractions = (np.arange(radial_intervals) + 0.5) / radial_intervals
        self.layer_indices = np.repeat(np.searchsorted(self.INTERFACES, midpoint_fractions), sectors)
        self.fixed = np.zeros(len(self.reference), dtype=bool)
        self.fixed[-sectors:] = True

        # Q1 basis on [-1,1]^2, node order: lower-left, lower-right,
        # upper-right, upper-left. Here xi runs radially and eta angularly.
        q = 1 / np.sqrt(3)
        points = np.array([[-q, -q], [q, -q], [q, q], [-q, q]])
        signs = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]])
        self.shape = (1 + points[:, 0, None] * signs[None, :, 0]) * (1 + points[:, 1, None] * signs[None, :, 1]) / 4
        derivatives = np.empty((4, 4, 2))
        derivatives[:, :, 0] = signs[None, :, 0] * (1 + points[:, 1, None] * signs[None, :, 1]) / 4
        derivatives[:, :, 1] = signs[None, :, 1] * (1 + points[:, 0, None] * signs[None, :, 0]) / 4
        jacobian = np.einsum("eai,qaj->eqij", self.reference[self.elements], derivatives)
        self.weights = np.linalg.det(jacobian)
        if np.any(self.weights <= 0):
            raise ValueError("Reference elements must have positive area.")
        self.gradients = np.einsum("qaj,eqjk->eqak", derivatives, np.linalg.inv(jacobian))
        quadrature_positions = np.einsum("qa,eai->eqi", self.shape, self.reference[self.elements])
        self.tangents = np.stack([-quadrature_positions[:, :, 1], quadrature_positions[:, :, 0]], axis=-1)
        self.tangents /= np.linalg.norm(self.tangents, axis=-1)[..., None]
        young = values[self.layer_indices, None]
        self.mu = young / (2 * (1 + poisson_ratio))
        self.lame = young * poisson_ratio / ((1 + poisson_ratio) * (1 - 2 * poisson_ratio))
        self.tension_density = active_stress * activation * (self.layer_indices[:, None] == 1)
        self.node_areas = np.zeros(len(self.reference))
        local_areas = np.einsum("eq,qa->ea", self.weights, self.shape)
        np.add.at(self.node_areas, self.elements.ravel(), local_areas.ravel())
        self.external = np.zeros_like(self.reference)
        # Lump a reference-radial dead traction using polygon boundary lengths.
        boundary_length = 2 * inner_radius * np.sin(np.pi / sectors)
        self.external[:sectors] = radial_traction * boundary_length * self.directions
        self.initial_area = self.lumen_area(self.reference)

        # Deformation gradient derivatives for the two ring radii of each cell.
        local_directions = self.directions[self.elements % sectors]
        self.radial_basis = np.stack([
            np.einsum("eai,eqaj->eqij", local_directions[:, [0, 3]], self.gradients[:, :, [0, 3]]),
            np.einsum("eai,eqaj->eqij", local_directions[:, [1, 2]], self.gradients[:, :, [1, 2]]),
        ], axis=2)

    def radial_positions(self, radii):
        return (np.asarray(radii)[:, None, None] * self.directions[None, :, :]).reshape(-1, 2)

    @property
    def positions(self):
        return self.radial_positions(self.radii)

    def lumen_area(self, positions):
        ring = positions[:self.sectors]
        following = np.roll(ring, -1, axis=0)
        return float(0.5 * np.sum(ring[:, 0] * following[:, 1] - ring[:, 1] * following[:, 0]))

    def state(self, positions):
        x = np.asarray(positions)
        if x.shape != self.reference.shape or not np.isfinite(x).all():
            raise ValueError("Positions must be finite and match the reference mesh.")
        deformation = np.einsum("eai,eqaj->eqij", x[self.elements], self.gradients)
        determinant = np.linalg.det(deformation)
        if np.any(determinant <= 0):
            raise ValueError("An element has nonpositive Jacobian.")
        inverse = np.linalg.inv(deformation)
        log_j = np.log(determinant)
        fiber = np.einsum("eqij,eqj->eqi", deformation, self.tangents)
        stretch = np.linalg.norm(fiber, axis=-1)
        unit_fiber = fiber / stretch[..., None]
        density = (self.mu / 2 * (np.sum(deformation ** 2, axis=(-2, -1)) - 2)
                   - self.mu * log_j + self.lame / 2 * log_j ** 2
                   + self.tension_density * (stretch - 1))
        stress = (self.mu[..., None, None] * deformation
                  + (self.lame * log_j - self.mu)[..., None, None] * inverse.swapaxes(-1, -2)
                  + self.tension_density[..., None, None] * unit_fiber[..., :, None] * self.tangents[..., None, :])
        energy = float(np.sum(self.weights * density) - np.sum(self.external * (x - self.reference)))
        return energy, stress, deformation, inverse, log_j, unit_fiber, stretch, determinant

    def energy_forces(self, positions):
        state = self.state(positions)
        local_forces = -np.einsum("eq,eqij,eqaj->eai", self.weights, state[1], self.gradients)
        forces = self.external.copy()
        np.add.at(forces, self.elements.ravel(), local_forces.reshape(-1, 2))
        return state[0], forces, float(state[-1].min())

    def radial_system(self, radii):
        x = self.radial_positions(radii)
        energy, stress, deformation, inverse, log_j, unit_fiber, stretch, _ = self.state(x)
        basis = self.radial_basis
        local_gradient = np.einsum("eq,eqij,eqlij->el", self.weights, stress, basis)
        inverse_basis = np.einsum("eqij,eqljk->eqlik", inverse, basis)
        traces = np.trace(inverse_basis, axis1=-2, axis2=-1)
        hessian_density = self.mu[..., None, None] * np.einsum("eqlij,eqmij->eqlm", basis, basis)
        hessian_density += (self.mu - self.lame * log_j)[..., None, None] * np.einsum("eqlij,eqmji->eqlm", inverse_basis, inverse_basis)
        hessian_density += self.lame[..., None, None] * traces[..., :, None] * traces[..., None, :]
        fiber_basis = np.einsum("eqlij,eqj->eqli", basis, self.tangents)
        along_fiber = np.einsum("eqi,eqli->eql", unit_fiber, fiber_basis)
        hessian_density += (self.tension_density / stretch)[..., None, None] * (
            np.einsum("eqli,eqmi->eqlm", fiber_basis, fiber_basis)
            - along_fiber[..., :, None] * along_fiber[..., None, :])
        local_hessian = np.einsum("eq,eqlm->elm", self.weights, hessian_density)
        size = len(radii)
        gradient, hessian = np.zeros(size), np.zeros((size, size))
        for a in range(2):
            np.add.at(gradient, self.element_rings + a, local_gradient[:, a])
            for b in range(2):
                np.add.at(hessian, (self.element_rings + a, self.element_rings + b), local_hessian[:, a, b])
        gradient -= np.sum(self.external.reshape(size, self.sectors, 2) * self.directions[None], axis=(1, 2))
        return energy, gradient, hessian

    def solve(self, force_density_tol=1e-7, max_iterations=60):
        """Newton relaxation on the symmetric branch, verified in full nodal space."""
        if not np.isfinite(force_density_tol) or force_density_tol <= 0:
            raise ValueError("force_density_tol must be finite and positive.")
        if not isinstance(max_iterations, (int, np.integer)) or max_iterations < 0:
            raise ValueError("max_iterations must be a nonnegative integer.")
        self.radii = self.reference_radii.copy()
        history = []
        for iteration in range(max_iterations + 1):
            energy, forces, minimum_j = self.energy_forces(self.positions)
            residual = float(np.max(np.linalg.norm(forces[~self.fixed], axis=1) / self.node_areas[~self.fixed]))
            history.append({"iteration": iteration, "potential": energy, "residual_density": residual,
                            "minimum_jacobian": minimum_j})
            if residual <= force_density_tol or iteration == max_iterations:
                break
            _, gradient, hessian = self.radial_system(self.radii)
            free_gradient, free_hessian = gradient[:-1], hessian[:-1, :-1]
            # A failed positive-definiteness test is a model/branch diagnostic.
            np.linalg.cholesky(free_hessian)
            direction = np.linalg.solve(free_hessian, -free_gradient)
            slope = float(free_gradient @ direction)
            step = 1.0
            for _ in range(40):
                trial = self.radii.copy()
                trial[:-1] += step * direction
                if trial[0] <= 0 or np.any(np.diff(trial) <= 0):
                    trial_energy = np.inf
                else:
                    try:
                        trial_energy = self.state(self.radial_positions(trial))[0]
                    except ValueError:
                        trial_energy = np.inf
                if trial_energy <= energy + 1e-4 * step * slope + 1e-12 * max(1.0, abs(energy)):
                    break
                step *= 0.5
            else:
                raise RuntimeError("No admissible energy-decreasing Newton step.")
            self.radii = trial
        return {"converged": residual <= force_density_tol, "iterations": iteration,
                "residual_density": residual, "minimum_jacobian": minimum_j,
                "history": history, "narrowing_percent": 100 * (1 - self.lumen_area(self.positions) / self.initial_area),
                "lumen_area": self.lumen_area(self.positions),
                "radii": self.radii.copy(), "reference_radii": self.reference_radii.copy(),
                "positions": self.positions.copy()}
