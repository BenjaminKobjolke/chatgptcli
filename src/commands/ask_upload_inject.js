// Sends validated image bytes through the page when Chrome blocks direct file input uploads.
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { IMAGE_MIME_TYPES } from '../core/prompt_images.js';

const CHUNK_BYTES = 192 * 1024;

export async function injectFilesInPage(page, paths, selector) {
  try {
    const files = paths.map((path) => {
      const extension = extname(path).toLowerCase();
      const mimeType = IMAGE_MIME_TYPES[extension];
      if (!mimeType) throw new Error(`unsupported image type: ${extension || 'unknown'}`);
      return { name: basename(path), mimeType, bytes: readFileSync(path) };
    });

    for (const [fileIndex, file] of files.entries()) {
      for (let offset = 0, chunkIndex = 0; offset < file.bytes.length; offset += CHUNK_BYTES, chunkIndex += 1) {
        const chunk = file.bytes.subarray(offset, offset + CHUNK_BYTES).toString('base64');
        const staged = await page.evaluate(`(() => {
          // Keep each bridge request below its daemon's 1 MB body limit.
          window.__chatgptcliFileChunks ??= [];
          window.__chatgptcliFileChunks[${fileIndex}] ??= [];
          window.__chatgptcliFileChunks[${fileIndex}][${chunkIndex}] = ${JSON.stringify(chunk)};
          return true;
        })()`);
        if (staged === false) throw new Error(`could not stage image data for ${file.name}`);
      }
    }

    const assignResult = await page.evaluate(buildAssignScript(files, selector));
    if (assignResult?.ok) return { ok: true };
    return { ok: false, reason: assignResult?.reason || 'page could not assign image files' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  } finally {
    try {
      await page.evaluate('(() => { delete window.__chatgptcliFileChunks; return true; })()');
    } catch {
      // Cleanup is best-effort; do not replace the upload result with a cleanup error.
    }
  }
}

function buildAssignScript(files, selector) {
  const fileData = files.map(({ name, mimeType }, index) => ({ name, mimeType, index }));
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return { ok: false, reason: 'composer file input not found' };
    if (input.dataset.chatgptcliAssigned === '1') return { ok: true };
    const staged = window.__chatgptcliFileChunks || [];
    const files = ${JSON.stringify(fileData)}.map(({ name, mimeType, index }) => {
      const base64 = (staged[index] || []).join('');
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new File([bytes], name, { type: mimeType });
    });
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dataset.chatgptcliAssigned = '1';
    const reactKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'));
    const onChange = reactKey && input[reactKey]?.onChange;
    if (onChange) onChange({ target: input, currentTarget: input });
    else {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true };
  })()`;
}
