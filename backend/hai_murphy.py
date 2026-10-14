"""Four-state Hai–Murphy kinetics and an illustrative quasistatic wall coupling.

State order is M, Mp, AMp, AM. Rates are in s^-1 and time is in seconds.
Default rates: Hai & Murphy (1988), Am J Physiol 255:C86–C94, pp. C86–C87,
https://doi.org/10.1152/ajpcell.1988.255.1.C86. These vascular-muscle rates
are not an airway calibration. No Huxley force–velocity extension is included.
"""

from dataclasses import dataclass

import numpy as np
from scipy.linalg import expm

try:
    from .continuum import ContinuumAirway
except ImportError:  # Notebook launched directly in backend/.
    from continuum import ContinuumAirway


STATE_NAMES = ("M", "Mp", "AMp", "AM")


@dataclass(frozen=True)
class HaiMurphyRates:
    k2: float = 0.5
    k3: float = 0.4
    k4: float = 0.1
    k5: float = 0.5
    k7: float = 0.01

    def __post_init__(self):
        values = np.array([self.k2, self.k3, self.k4, self.k5, self.k7])
        if not np.isfinite(values).all() or np.any(values < 0):
            raise ValueError("Rate constants must be finite and nonnegative.")

    def generator(self, kinase_rate):
        """Return Q in dy/dt = Q y, with prescribed k1 = k6 = kinase_rate."""
        if not np.isscalar(kinase_rate) or not np.isfinite(kinase_rate) or kinase_rate < 0:
            raise ValueError("The kinase rate must be finite and nonnegative.")
        k1 = k6 = float(kinase_rate)
        return np.array([
            [-k1, self.k2, 0, self.k7],
            [k1, -(self.k2 + self.k3), self.k4, 0],
            [0, self.k3, -(self.k4 + self.k5), k6],
            [0, 0, self.k5, -(k6 + self.k7)],
        ])

    def steady_state(self, kinase_rate):
        """Stationary fractions; reject rates with no unique stationary state."""
        matrix = self.generator(kinase_rate)
        matrix[-1] = 1
        try:
            result = np.linalg.solve(matrix, [0, 0, 0, 1])
        except np.linalg.LinAlgError as error:
            raise ValueError("These rates do not determine a unique steady state.") from error
        validate_populations(result)
        return result


@dataclass(frozen=True)
class ActivationProtocol:
    """Right-continuous, piecewise constant k1=k6, starting at t=0.

    Each rate applies from its switch time until the next switch; the final
    rate continues indefinitely. The input is a kinase rate, not a measured
    calcium concentration or a normalized wall activation.
    """

    switch_times: tuple
    kinase_rates: tuple

    def __post_init__(self):
        times = np.asarray(self.switch_times, dtype=float)
        rates = np.asarray(self.kinase_rates, dtype=float)
        if (times.ndim != 1 or rates.ndim != 1 or len(times) == 0
                or len(times) != len(rates) or not np.isfinite(times).all()
                or not np.isfinite(rates).all() or times[0] != 0
                or np.any(np.diff(times) <= 0) or np.any(rates < 0)):
            raise ValueError("Provide increasing switch times starting at zero and matching nonnegative rates.")
        object.__setattr__(self, "switch_times", tuple(times.tolist()))
        object.__setattr__(self, "kinase_rates", tuple(rates.tolist()))

    def values(self, times):
        times = np.asarray(times, dtype=float)
        if not np.isfinite(times).all() or np.any(times < 0):
            raise ValueError("Protocol times must be finite and nonnegative.")
        indices = np.searchsorted(self.switch_times, times, side="right") - 1
        return np.asarray(self.kinase_rates)[indices]


def validate_populations(states):
    states = np.asarray(states, dtype=float)
    if (states.ndim not in (1, 2) or states.shape[-1] != 4 or states.size == 0
            or not np.isfinite(states).all() or np.any(states < -1e-12)
            or not np.allclose(states.sum(axis=-1), 1, atol=1e-12, rtol=0)):
        raise ValueError("Populations must have four nonnegative fractions summing to one.")
    return states


def simulate(times, protocol, *, rates=None, initial=None):
    """Propagate exactly on constant-rate intervals, up to floating-point error.

    The initial population is defined at t=0, even if the first requested time
    is later. Every protocol discontinuity is integrated explicitly, including
    switches absent from the output grid. No clipping or renormalization is used.
    """
    times = np.asarray(times, dtype=float)
    if (times.ndim != 1 or len(times) == 0 or not np.isfinite(times).all()
            or times[0] < 0 or np.any(np.diff(times) <= 0)):
        raise ValueError("Output times must be finite, nonnegative, and strictly increasing.")
    if not isinstance(protocol, ActivationProtocol):
        raise TypeError("protocol must be an ActivationProtocol.")
    rates = HaiMurphyRates() if rates is None else rates
    state = validate_populations([1., 0., 0., 0.] if initial is None else initial).copy()
    if state.ndim != 1:
        raise ValueError("Specify one initial population.")
    result = np.empty((len(times), 4))
    current_time, segment = 0.0, 0
    propagators = {}

    def advance(population, duration, index):
        if duration == 0:
            return population
        key = (duration, protocol.kinase_rates[index])
        if key not in propagators:
            propagators[key] = expm(rates.generator(key[1]) * duration)
        return propagators[key] @ population

    for i, target in enumerate(times):
        while segment + 1 < len(protocol.switch_times) and protocol.switch_times[segment + 1] <= target:
            switch = protocol.switch_times[segment + 1]
            state = advance(state, switch - current_time, segment)
            current_time = switch
            segment += 1
        state = advance(state, target - current_time, segment)
        current_time = float(target)
        result[i] = state
    validate_populations(result)
    return result


def quasistatic_response(states, *, radial_intervals=20, sectors=80,
                         moduli=None, poisson_ratio=0.25, tension_scale=20.0,
                         force_density_tol=1e-7, max_iterations=60):
    """Solve a fresh symmetric wall equilibrium for each attached fraction.

    Active nominal tension density = tension_scale * (AMp + AM). Wall lengths,
    moduli and tension remain dimensionless. There is no mechanical clock,
    viscosity, strain feedback to rates, or force–velocity law. Failure raises
    rather than returning an unconverged geometry as a valid time sample.
    """
    states = validate_populations(states)
    if states.ndim != 2:
        raise ValueError("Provide a time series of populations.")
    attached = states[:, 2] + states[:, 3]
    # Only bound floating-point excursions at the endpoints; kinetics are never
    # altered. Population errors larger than 1e-12 were rejected above.
    activation = np.clip(attached, 0, 1)
    rows = []
    for i, value in enumerate(activation):
        model = ContinuumAirway(radial_intervals, sectors, moduli=moduli,
                               poisson_ratio=poisson_ratio, active_stress=tension_scale,
                               activation=float(value))
        result = model.solve(force_density_tol=force_density_tol, max_iterations=max_iterations)
        if (not result["converged"] or result["minimum_jacobian"] <= 0
                or result["radii"][0] <= 0 or np.any(np.diff(result["radii"]) <= 0)
                or not np.array_equal(result["positions"][model.fixed], model.reference[model.fixed])):
            raise RuntimeError(f"Wall equilibrium failed at sample {i}: residual={result['residual_density']:.3e}")
        rows.append(result)
    fields = ("narrowing_percent", "lumen_area", "residual_density", "minimum_jacobian",
              "iterations", "converged", "radii")
    return {**{key: np.asarray([row[key] for row in rows]) for key in fields},
            "attached_fraction": attached.copy(), "tension_density": tension_scale * activation,
            "reference_radii": model.reference_radii.copy()}
