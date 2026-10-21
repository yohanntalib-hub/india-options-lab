import { simulate } from './pricing.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ type: 'result', result: simulate(data.fit, data.options, progress => self.postMessage({ type: 'progress', progress })) }); }
  catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
