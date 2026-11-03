import {
  IS_COMPILED,
  captureOpenCli as captureOpenCliForApp,
  connectBridge as connectBridgeForApp,
  loadBrowserBridge as loadBrowserBridgeForApp,
  openCliEnvNames,
  resolveOpenCliPaths as resolveOpenCliPathsForApp,
  runOpenCli as runOpenCliForApp,
  __resetExecRunnerForTest,
  __setExecRunnerForTest
} from '../../.omx/reference/opencli-app-kit/src/core/opencli.js';

const APP_NAME = 'chatgptcli';
const envNames = openCliEnvNames(APP_NAME);

export { IS_COMPILED, openCliEnvNames, __resetExecRunnerForTest, __setExecRunnerForTest };
export const OPENCLI_ENV = Object.freeze({ ROOT: envNames.root, MAIN: envNames.main });

export function resolveOpenCliPaths() {
  return resolveOpenCliPathsForApp(APP_NAME);
}

export function runOpenCli(args) {
  return runOpenCliForApp(APP_NAME, args);
}

export function captureOpenCli(args) {
  return captureOpenCliForApp(APP_NAME, args);
}

export function loadBrowserBridge() {
  return loadBrowserBridgeForApp(APP_NAME);
}

export function connectBridge(bridge, options) {
  return connectBridgeForApp(bridge, { appName: APP_NAME, ...options });
}
