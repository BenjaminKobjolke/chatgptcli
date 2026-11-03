#!/usr/bin/env bun
import { runMain } from '../.omx/reference/opencli-app-kit/src/core/main_entry.js';
import { runCli } from './cli.js';

await runMain(runCli);
