import { runSimulation, generateStiffnessCurve } from './simulation.js';

globalThis.onmessage = ({ data: { id, type, parameters, mode } }) => {
  const onProgress = progress => globalThis.postMessage({ id, type: 'progress', progress });
  try {
    const result = type === 'sweep'
      ? generateStiffnessCurve(parameters, { onProgress })
      : runSimulation(parameters, { mode, onProgress });
    globalThis.postMessage({ id, type: 'result', result });
  } catch (error) {
    globalThis.postMessage({ id, type: 'error', message: error.message });
  }
};
