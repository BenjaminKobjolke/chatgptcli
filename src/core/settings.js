import { createSettings } from '../../.omx/reference/opencli-app-kit/src/core/settings.js';

const settings = createSettings('chatgptcli');

export const settingsPath = settings.settingsPath;
export const loadSettings = settings.loadSettings;
export const saveSettings = settings.saveSettings;
export const resolveBridgeProfile = settings.resolveBridgeProfile;
export const resolveChrome = settings.resolveChrome;
