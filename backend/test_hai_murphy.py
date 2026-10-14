"""Independent kinetic limits, published reference, and wall coupling checks."""

import unittest
from dataclasses import asdict

import numpy as np
from scipy.integrate import solve_ivp

try:
    from .hai_murphy import ActivationProtocol, HaiMurphyRates, simulate, quasistatic_response
    from .continuum import ContinuumAirway
except ImportError:
    from hai_murphy import ActivationProtocol, HaiMurphyRates, simulate, quasistatic_response
    from continuum import ContinuumAirway


class HaiMurphyTests(unittest.TestCase):
    def test_generator_against_seven_transition_fluxes(self):
        rates = HaiMurphyRates(k2=0.7, k3=0.3, k4=0.13, k5=0.4, k7=0.02)
        kinase = 0.23
        state = np.array([0.2, 0.3, 0.1, 0.4])
        expected = np.zeros(4)
        for source, destination, rate in [(0, 1, kinase), (1, 0, rates.k2),
                (1, 2, rates.k3), (2, 1, rates.k4), (2, 3, rates.k5),
                (3, 2, kinase), (3, 0, rates.k7)]:
            flux = rate * state[source]
            expected[source] -= flux
            expected[destination] += flux
        np.testing.assert_allclose(rates.generator(kinase) @ state, expected, atol=1e-16)
        np.testing.assert_allclose(rates.generator(kinase).sum(axis=0), 0, atol=1e-16)

    def test_each_transition_against_single_exponential(self):
        zero_rates = {key: 0.0 for key in asdict(HaiMurphyRates())}
        times = np.array([0, 0.1, 1, 10])
        for key, source, destination in [("k1", 0, 1), ("k2", 1, 0), ("k3", 1, 2),
                ("k4", 2, 1), ("k5", 2, 3), ("k6", 3, 2), ("k7", 3, 0)]:
            with self.subTest(rate=key):
                values = zero_rates.copy()
                kinase = 0.7 if key in ("k1", "k6") else 0
                if key in values:
                    values[key] = 0.7
                initial = np.eye(4)[source]
                actual = simulate(times, ActivationProtocol((0,), (kinase,)),
                                  rates=HaiMurphyRates(**values), initial=initial)
                expected = np.zeros_like(actual)
                expected[:, source] = np.exp(-0.7 * times)
                expected[:, destination] = 1 - expected[:, source]
                np.testing.assert_allclose(actual, expected, atol=2e-15)

    def test_conservation_positivity_and_unaligned_switches(self):
        protocol = ActivationProtocol((0, 0.37, 2.81, 30.2), (0, 0.55, 0.1, 0))
        times = np.r_[0., np.arange(0.1, 601, 1.7)]
        states = simulate(times, protocol)
        self.assertGreaterEqual(states.min(), 0)
        np.testing.assert_allclose(states.sum(axis=1), 1, atol=1e-13, rtol=0)
        # Sparse sampling must still integrate every internal switch.
        sparse = simulate([times[-1]], protocol)
        np.testing.assert_allclose(sparse[0], states[-1], atol=1e-13, rtol=0)
        np.testing.assert_array_equal(protocol.values([0, 0.37, 2.81, 30.2]), [0, .55, .1, 0])
        before_after = simulate([0.37, 0.37 + 1e-9], protocol)
        np.testing.assert_allclose(before_after[0], [1, 0, 0, 0], atol=1e-15)
        self.assertGreater(before_after[1, 1], 0)

    def test_scalar_phosphorylation_and_latch_decay(self):
        times = np.linspace(0, 100, 201)
        kinase, dephosphorylation = .23, .5
        states = simulate(times, ActivationProtocol((0,), (kinase,)))
        p_inf = kinase / (kinase + dephosphorylation)
        expected = p_inf * (1 - np.exp(-(kinase + dephosphorylation) * times))
        np.testing.assert_allclose(states[:, 1] + states[:, 2], expected, atol=1e-14)
        off = simulate(times, ActivationProtocol((0,), (0,)), initial=[0, 0, 0, 1])
        np.testing.assert_allclose(off[:, 3], np.exp(-.01 * times), atol=1e-14)
        resting = simulate(times, ActivationProtocol((0,), (0,)))
        np.testing.assert_array_equal(resting, np.tile([1, 0, 0, 0], (len(times), 1)))
        relaxed = simulate([4000], ActivationProtocol((0, 30), (.55, 0)))
        np.testing.assert_allclose(relaxed[0], [1, 0, 0, 0], atol=2e-13)

    def test_independent_adaptive_integration(self):
        rates = HaiMurphyRates()
        protocol = ActivationProtocol((0, 1.3, 8.7), (0, .55, 0))
        initial = np.array([1., 0, 0, 0])
        # Written directly as flux balances, independent of generator assembly.
        for start, end, kinase in zip((0, 1.3, 8.7), (1.3, 8.7, 100), protocol.kinase_rates):
            def rhs(t, y):
                m, mp, amp, am = y
                return [-kinase*m + .5*mp + .01*am,
                        kinase*m - .9*mp + .1*amp,
                        .4*mp - .6*amp + kinase*am,
                        .5*amp - (kinase + .01)*am]
            integrated = solve_ivp(rhs, (start, end), initial, method="DOP853", rtol=1e-11, atol=1e-13)
            self.assertTrue(integrated.success)
            initial = integrated.y[:, -1]
            exact = simulate([end], protocol, rates=rates)[0]
            np.testing.assert_allclose(initial, exact, atol=2e-11, rtol=0)

    def test_published_apparent_rates_and_stationary_population(self):
        rates = HaiMurphyRates()
        for kinase in np.logspace(-3, 1, 9):
            state = rates.steady_state(kinase)
            m, mp, amp, am = state
            # Hai & Murphy, 1988, C87, Eqs. 3 and 4 (independent algebra).
            numerator = rates.k4 * kinase + rates.k4 * rates.k7 + rates.k5 * rates.k7
            f = kinase * rates.k3 * numerator / ((kinase + rates.k2) * numerator + rates.k3 * rates.k5 * rates.k7)
            g = numerator / (rates.k5 + kinase + rates.k7)
            np.testing.assert_allclose([rates.k3 * mp / (m + mp),
                                       (rates.k4 * amp + rates.k7 * am) / (amp + am)], [f, g], atol=1e-14)
            np.testing.assert_allclose(rates.generator(kinase) @ state, 0, atol=1e-14)
            np.testing.assert_allclose(simulate([6000], ActivationProtocol((0,), (kinase,)))[0], state, atol=1e-11)

    def test_coupling_equal_attached_fractions_and_zero_tension(self):
        states = np.array([[1, 0, 0, 0], [.4, 0, .6, 0], [0, .4, 0, .6]])
        response = quasistatic_response(states, radial_intervals=10, sectors=20)
        np.testing.assert_allclose(response["tension_density"], [0, 12, 12])
        self.assertEqual(response["narrowing_percent"][0], 0)
        self.assertGreater(response["narrowing_percent"][1], 0)
        np.testing.assert_allclose(response["radii"][1], response["radii"][2], atol=1e-13)
        direct = ContinuumAirway(10, 20, activation=.6).solve()
        np.testing.assert_allclose(response["radii"][1], direct["radii"], atol=1e-13)
        unloaded = quasistatic_response(states, radial_intervals=10, sectors=20, tension_scale=0)
        np.testing.assert_array_equal(unloaded["narrowing_percent"], 0)

    def test_failed_wall_solve_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "sample 0"):
            quasistatic_response([[0, 0, 1, 0]], radial_intervals=10, sectors=20, max_iterations=0)

    def test_invalid_inputs(self):
        for kwargs in ({"k7": -.1}, {"k2": np.nan}):
            with self.assertRaises(ValueError):
                HaiMurphyRates(**kwargs)
        for times, rates in [([], []), ([1], [.1]), ([0, 0], [.1, .2]),
                             ([0], [-1]), ([0], [np.inf]), ([0, 1], [.1])]:
            with self.assertRaises(ValueError):
                ActivationProtocol(times, rates)
        protocol = ActivationProtocol((0,), (0,))
        for times in ([], [-1], [0, 0], [1, 0], [np.nan]):
            with self.assertRaises(ValueError):
                simulate(times, protocol)
        for initial in ([1, 1, 0, 0], [-.1, 1.1, 0, 0], [1, 0], [np.nan, 0, 0, 0]):
            with self.assertRaises(ValueError):
                simulate([0, 1], protocol, initial=initial)
        with self.assertRaises(ValueError):
            HaiMurphyRates().generator(-1)
        with self.assertRaises(ValueError):
            HaiMurphyRates(k2=0, k3=0, k4=0, k5=0, k7=0).steady_state(0)


if __name__ == "__main__":
    unittest.main()
