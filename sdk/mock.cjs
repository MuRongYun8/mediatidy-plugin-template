'use strict';
const vm = require('node:vm');
// This mock is for trusted local tests; production always uses the Go worker.
function runPlugin(code, input, handlers = {}) {
  const calls = [];
  const sdk = {};
  for (const [group, methods] of Object.entries({ files: ['roots','list','stat'], ai: ['complete'], tmdb: ['search','detail','season'], organize: ['profiles','prepare'], tasks: ['list','cancel'], storage: ['get','set','delete'], config: ['get'], notification: ['send'], strm: ['run'], http: ['request'] })) {
    sdk[group] = {};
    for (const method of methods) sdk[group][method] = arg => {
      const name = `${group}.${method}`;
      calls.push({ name, input: structuredClone(arg) });
      if (!handlers[name]) throw new Error(`Missing mock: ${name}`);
      return structuredClone(handlers[name](arg));
    };
    Object.freeze(sdk[group]);
  }
  sdk.log = arg => { calls.push({ name: 'log', input: arg }); return true; };
  const context = vm.createContext({ module: { exports: {} }, mt: Object.freeze(sdk), input: structuredClone(input) });
  vm.runInContext(code, context, { timeout: 1000 });
  const result = vm.runInContext('module.exports.run(input)', context, { timeout: 5000 });
  return { result, calls };
}
module.exports = { runPlugin };
