/**
 * Host half of the `logs` feature: the entry a host assembly imports.
 *
 * Like every feature directory, this file is the host entry, `./contract.js`
 * its shared contract, and `./card.js` the browser entry browser code imports
 * directly instead of going through here (a browser half must never pull the
 * collector, the file system or the config schema).
 */
export * from './contract.js';
export { createLogsModule } from './host.js';
export { createLogsRpcMethods } from './rpc.js';
