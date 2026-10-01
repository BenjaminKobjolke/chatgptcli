import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { EXIT_CODE } from '../core/errors.js';
import { IS_COMPILED, OPENCLI_ENV, loadBrowserBridge, resolveOpenCliPaths } from '../core/opencli.js';
import { resolveBridgeProfile } from '../core/settings.js';

const EXTENSION_STORE_URL = 'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk';
const BRIDGE_STATE = Object.freeze({ STOPPED: 'stopped', PROFILE_REQUIRED: 'profile-required' });
const SWITCH_SESSION_STEP = '- Pick the browser profile to use: `chatgptcli switch-session`.';

let runProcess = (cmd, args, options) => spawnSync(cmd, args, options);
let pathExists = (path) => existsSync(path);
let isCompiled = IS_COMPILED;
let bridgeStatus = fetchBridgeStatus;

export function __setSetupDepsForTest(deps) {
  if (deps.runProcess) {
    runProcess = deps.runProcess;
  }
  if (deps.pathExists) {
    pathExists = deps.pathExists;
  }
  if (deps.bridgeStatus) {
    bridgeStatus = deps.bridgeStatus;
  }
  if ('isCompiled' in deps) {
    isCompiled = deps.isCompiled;
  }
}

export function __resetSetupDepsForTest() {
  runProcess = (cmd, args, options) => spawnSync(cmd, args, options);
  pathExists = (path) => existsSync(path);
  isCompiled = IS_COMPILED;
  bridgeStatus = fetchBridgeStatus;
}

// Every check is `{ ok, message, steps }`: one [OK]/[FAIL] line plus the next
// steps that follow from it.
export async function runSetup() {
  const checks = isCompiled ? [{ ok: true, message: 'opencli Browser Bridge: bundled', steps: [] }] : sourceChecks();
  // Asking the daemon loads the bridge, and from source that bootstraps a
  // missing opencli build — setup changes nothing, so it only asks once the
  // on-disk checks hold.
  if (checks.every((check) => check.ok)) {
    checks.push(await bridgeCheck());
  }

  const lines = ['chatgptcli setup', '', ...checks.map((check) => `${check.ok ? '[OK]' : '[FAIL]'} ${check.message}`), ''];
  if (!isCompiled) {
    lines.push(`Path source: ${OPENCLI_ENV.ROOT}/${OPENCLI_ENV.MAIN} env override or built-in default.`, '');
  }

  lines.push('Actionable next steps:', ...checks.flatMap((check) => check.steps));
  lines.push('- Launch dedicated browser profile: `chatgptcli launch` (configure via `chatgptcli set-chrome <exe> [--profile <dir>]`).');
  lines.push('- In that browser, complete one-time login at `https://chatgpt.com/`.');
  if (isCompiled) {
    lines.push(`- Reuse existing Chrome profile option: install the OpenCLI extension from ${EXTENSION_STORE_URL}.`);
    lines.push('- Verify end-to-end: `chatgptcli ask "hello"`.');
  } else {
    lines.push(`- Reuse existing Chrome profile option: load unpacked extension from "${resolveOpenCliPaths().extensionPath}".`);
    lines.push('- Verify end-to-end: `bun run src/main.js ask "hello"`.');
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  return checks.every((check) => check.ok) ? EXIT_CODE.SUCCESS : EXIT_CODE.CONFIG;
}

// Only meaningful from source: a compiled exe bundles the bridge and runs
// without Bun, and these paths resolve into its virtual filesystem.
function sourceChecks() {
  const bunCheck = checkBun();
  const { root, mainPath, extensionPath, browserIndexPath } = resolveOpenCliPaths();
  const rootExists = pathExists(root);
  const built = pathExists(mainPath) && pathExists(browserIndexPath);

  return [
    {
      ok: bunCheck.ok,
      message: `Bun available${bunCheck.version ? ` (${bunCheck.version})` : ''}`,
      steps: bunCheck.ok ? [] : ['- Install Bun and ensure `bun` is on PATH: https://bun.sh']
    },
    {
      ok: rootExists,
      message: `opencli root resolved: ${root}`,
      steps: rootExists
        ? []
        : [
            `- Set ${OPENCLI_ENV.ROOT} to your local opencli checkout path.`,
            '- Or place opencli at `.omx/reference/opencli` under this repo.'
          ]
    },
    {
      ok: pathExists(mainPath),
      message: `opencli built entry: ${mainPath}`,
      steps: rootExists && !built ? [`- Build opencli once: cd "${root}" && bun install`] : []
    },
    { ok: pathExists(browserIndexPath), message: `opencli browser bridge module: ${browserIndexPath}`, steps: [] },
    {
      ok: pathExists(extensionPath),
      message: `Browser Bridge extension dir: ${extensionPath}`,
      steps: pathExists(extensionPath) ? [] : [`- Ensure Browser Bridge extension exists at "${extensionPath}".`]
    }
  ];
}

async function fetchBridgeStatus() {
  const stored = resolveBridgeProfile();
  const { getDaemonHealth } = await loadBrowserBridge();
  return { stored, health: await getDaemonHealth({ preferredContextId: stored }) };
}

// Boundary normalizer for the daemon's health report; an unreachable daemon
// and a failed lookup both read as "stopped".
function normalizeBridgeStatus(value) {
  const object = value && typeof value === 'object' ? value : {};
  const profiles = Array.isArray(object.health?.status?.profiles) ? object.health.status.profiles : [];
  return {
    stored: typeof object.stored === 'string' ? object.stored : '',
    state: typeof object.health?.state === 'string' ? object.health.state : BRIDGE_STATE.STOPPED,
    connected: profiles.filter((profile) => profile?.extensionConnected).map((profile) => String(profile.contextId))
  };
}

async function bridgeCheck() {
  const { stored, state, connected } = normalizeBridgeStatus(await bridgeStatus().catch(() => null));

  // Not a failure: the daemon is started by the first command that needs it.
  if (state === BRIDGE_STATE.STOPPED) {
    return { ok: true, message: 'Browser Bridge daemon not running yet (it starts with the first ask or read)', steps: [] };
  }
  if (!connected.length) {
    return {
      ok: false,
      message: 'Browser Bridge: no browser profile connected',
      steps: [`- Start the browser (\`chatgptcli launch\`) and make sure the OpenCLI extension is enabled: ${EXTENSION_STORE_URL}`]
    };
  }
  if (state === BRIDGE_STATE.PROFILE_REQUIRED) {
    return {
      ok: false,
      message: `Browser Bridge: several profiles connected (${connected.join(', ')}), none selected`,
      steps: [SWITCH_SESSION_STEP]
    };
  }
  // The daemon falls back to the only connected profile, so commands work —
  // but nothing else ever says the stored pick went stale.
  if (stored && !connected.includes(stored)) {
    return {
      ok: true,
      message: `Browser Bridge connected: ${connected[0]} (stored default ${stored} is not connected)`,
      steps: [SWITCH_SESSION_STEP]
    };
  }
  return { ok: true, message: `Browser Bridge connected: ${stored || connected[0]}`, steps: [] };
}

function checkBun() {
  const result = runProcess('bun', ['--version'], {
    stdio: 'pipe',
    encoding: 'utf8'
  });

  if (result.error || result.status !== 0) {
    return { ok: false, version: '' };
  }

  return {
    ok: true,
    version: typeof result.stdout === 'string' ? result.stdout.trim() : ''
  };
}
