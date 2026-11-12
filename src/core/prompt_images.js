// Validates local image paths before the browser bridge is opened.
import { statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { AppError, ERROR_CODE } from './errors.js';

export const IMAGE_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const ALLOWED_TYPES = IMAGE_EXTENSIONS.join(', ');
const IMAGE_FILE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS, '.bmp', '.svg', '.tif', '.tiff', '.avif', '.heic', '.heif', '.ico'
]);

export function isImagePath(filePath) {
  return IMAGE_FILE_EXTENSIONS.has(extname(String(filePath)).toLowerCase());
}

export function resolveImagePaths(paths) {
  if (paths.length > MAX_IMAGES) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `Too many images: maximum is ${MAX_IMAGES}.`);
  }

  return paths.map((filePath) => {
    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      stats = null;
    }
    if (!stats?.isFile()) {
      throw new AppError(ERROR_CODE.INPUT_INVALID, `Image not found: ${filePath}`, {
        hint: 'Pass an existing image file.'
      });
    }

    if (!IMAGE_EXTENSIONS.includes(extname(filePath).toLowerCase())) {
      throw new AppError(ERROR_CODE.INPUT_INVALID, `Unsupported image type: ${filePath}`, {
        hint: `Supported image types: ${ALLOWED_TYPES}.`
      });
    }

    if (stats.size > MAX_IMAGE_BYTES) {
      throw new AppError(ERROR_CODE.INPUT_INVALID, `Image too large: ${filePath} (${stats.size} bytes)`, {
        hint: `Maximum image size is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`
      });
    }

    return resolve(filePath);
  });
}
