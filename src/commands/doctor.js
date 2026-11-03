import { runDoctor as runSharedDoctor } from '../../.omx/reference/opencli-app-kit/src/commands/doctor.js';

export function runDoctor(options) {
  return runSharedDoctor({ ...options, appName: 'chatgptcli' });
}
