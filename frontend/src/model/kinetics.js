// Same four states, transitions, and units as backend/hai_murphy.py.
// Small matrix exponentials use uniformization and scaling/squaring.
// No population clipping or renormalization; parity is checked against SciPy.
export const STATE_NAMES = ['M', 'Mp', 'AMp', 'AM'];
export const DEFAULT_RATES = Object.freeze({ k2: .5, k3: .4, k4: .1, k5: .5, k7: .01 });
export const DEFAULT_PROTOCOL = Object.freeze({ switchTimes: Object.freeze([0, 10, 30, 120]), kinaseRates: Object.freeze([0, .55, .1, 0]) });
const identity = () => Array.from({ length: 16 }, (_, i) => i % 5 === 0 ? 1 : 0);
const multiply = (a, b) => Array.from({ length: 16 }, (_, index) => {
  const i = Math.floor(index / 4), j = index % 4;
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += a[4*i + k] * b[4*k + j];
  return sum;
});

export function validatePopulation(state) {
  if (!Array.isArray(state) || state.length !== 4 || state.some(v => !Number.isFinite(v) || v < -1e-12)
    || Math.abs(state.reduce((a, b) => a + b, 0) - 1) > 1e-12) {
    throw new Error('Cross-bridge fractions must be nonnegative and sum to one.');
  }
}

export function validateProtocol(protocol) {
  const { switchTimes: times, kinaseRates: rates } = protocol;
  if (!Array.isArray(times) || !Array.isArray(rates) || !times.length || times.length !== rates.length
    || times[0] !== 0 || times.some((t, i) => !Number.isFinite(t) || (i && t <= times[i - 1]))
    || rates.some(k => !Number.isFinite(k) || k < 0)) throw new Error('Invalid kinase protocol.');
}

export function kinaseAt(time, protocol = DEFAULT_PROTOCOL) {
  if (!Number.isFinite(time) || time < 0) throw new Error('Kinetic time must be nonnegative.');
  let index = 0;
  while (index + 1 < protocol.switchTimes.length && protocol.switchTimes[index + 1] <= time) index++;
  return protocol.kinaseRates[index];
}

export function generator(kinase, rates = DEFAULT_RATES) {
  if (!Number.isFinite(kinase) || kinase < 0 || Object.keys(DEFAULT_RATES).some(k => !Number.isFinite(rates[k]) || rates[k] < 0)) {
    throw new Error('Kinetic rates must be finite and nonnegative.');
  }
  const { k2, k3, k4, k5, k7 } = rates;
  return [-kinase, k2, 0, k7, kinase, -(k2 + k3), k4, 0,
    0, k3, -(k4 + k5), kinase, 0, 0, k5, -(kinase + k7)];
}

export function transitionMatrix(duration, kinase, rates = DEFAULT_RATES) {
  if (!Number.isFinite(duration) || duration < 0) throw new Error('Invalid propagation duration.');
  const Q = generator(kinase, rates);
  const q = Math.max(-Q[0], -Q[5], -Q[10], -Q[15]);
  if (!duration || !q) return identity();
  const total = q * duration;
  if (!Number.isFinite(total)) throw new Error('Propagation interval is too large.');
  const scaling = Math.max(0, Math.ceil(Math.log2(total / .5)));
  const lambda = total / 2**scaling;
  const P = Q.map((value, i) => value / q + (i % 5 === 0 ? 1 : 0));
  let power = identity(), weight = Math.exp(-lambda);
  let result = power.map(v => v * weight);
  for (let order = 1; order < 100; order++) {
    power = multiply(power, P);
    weight *= lambda / order;
    result = result.map((value, i) => value + weight*power[i]);
    if (weight < 1e-18) break;
  }
  for (let i = 0; i < scaling; i++) result = multiply(result, result);
  return result;
}

export function simulateKinetics(times, protocol = DEFAULT_PROTOCOL, rates = DEFAULT_RATES, initial = [1, 0, 0, 0]) {
  validateProtocol(protocol);
  validatePopulation(initial);
  generator(0, rates);
  if (!Array.isArray(times) || !times.length || times.some((t, i) => !Number.isFinite(t) || t < 0 || (i && t <= times[i - 1]))) {
    throw new Error('Output times must be nonnegative and strictly increasing.');
  }
  let state = [...initial], currentTime = 0, segment = 0;
  const cache = new Map();
  function advance(duration) {
    if (!duration) return;
    const key = `${duration}:${protocol.kinaseRates[segment]}`;
    if (!cache.has(key)) cache.set(key, transitionMatrix(duration, protocol.kinaseRates[segment], rates));
    const matrix = cache.get(key);
    state = state.map((_, i) => state.reduce((sum, value, j) => sum + matrix[4*i + j]*value, 0));
  }
  return times.map(target => {
    while (segment + 1 < protocol.switchTimes.length && protocol.switchTimes[segment + 1] <= target) {
      const switchTime = protocol.switchTimes[segment + 1];
      advance(switchTime - currentTime);
      currentTime = switchTime;
      segment++;
    }
    advance(target - currentTime);
    currentTime = target;
    validatePopulation(state);
    return [...state];
  });
}

export function notebookTimes() {
  return [...Array.from({ length: 641 }, (_, i) => i * .25),
    ...Array.from({ length: 352 }, (_, i) => 161.25 + i * 1.25)];
}
