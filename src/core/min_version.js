import {
  checkMinVersion as checkSharedMinVersion,
  compareSemver
} from '../../.omx/reference/opencli-app-kit/src/core/min_version.js';

const APP_NAME = 'chatgptcli';
const DOWNLOAD_URL = 'https://github.com/BenjaminKobjolke/chatgptcli/releases/latest/download/chatgptcli.exe';

export function checkMinVersion(currentVersion) {
  const message = checkSharedMinVersion(currentVersion, APP_NAME, { downloadUrl: DOWNLOAD_URL });
  if (!message) return null;

  const [updateRequired] = message.split('\n');
  return [
    updateRequired,
    'Update it:',
    '  taskkill /im chatgptcli.exe /f',
    `  powershell -Command "Invoke-WebRequest '${DOWNLOAD_URL}' -OutFile \\"$HOME\\.chatgptcli\\bin\\chatgptcli.exe\\""`,
    'Then retry the original command.'
  ].join('\n');
}

export { compareSemver };
export const __test__ = { compareSemver };
