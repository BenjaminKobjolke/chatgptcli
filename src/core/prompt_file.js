// Builds the ask prompt when --file is given: inlines the file's text as a delimited block.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { AppError, ERROR_CODE } from './errors.js';

// ponytail: 1MB cap, raise if real use hits it — huge DOM inserts can hang the composer
const MAX_FILE_BYTES = 1024 * 1024;

export function buildPromptWithFile(prompt, filePath) {
  let stats = null;
  try {
    stats = statSync(filePath);
  } catch {
    // fall through to the not-found error below
  }
  if (!stats || !stats.isFile()) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `File not found: ${filePath}`, {
      hint: 'Pass an existing text file, e.g. --file "README.md".'
    });
  }

  if (stats.size > MAX_FILE_BYTES) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `File too large: ${filePath} (${stats.size} bytes)`, {
      hint: 'Max 1 MB. Trim the file or send an excerpt.'
    });
  }

  const content = readFileSync(filePath, 'utf8');
  return `${prompt}\n\n--- FILE: ${basename(filePath)} ---\n${content}\n--- END FILE ---`;
}
