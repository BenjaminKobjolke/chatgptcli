import { describe, expect, test } from 'bun:test';
import { formatComposerState, readComposerState } from '../src/commands/ask_composer_state.js';

describe('ask composer state', () => {
  test('formats the composer snapshot as compact key-value pairs', () => {
    expect(formatComposerState({
      url: 'https://chatgpt.com/c/123',
      fileInputs: 2,
      markedInputFiles: 3,
      tiles: 3,
      largeImages: 3,
      uploading: 0,
      send: { found: true, disabled: false, testId: 'send-button', ariaLabel: 'Send' },
      stop: false,
      editorChars: 8,
      userMessages: 1,
      alert: '',
      uploadPath: 'native'
    })).toBe('url=https://chatgpt.com/c/123 fileInputs=2 markedInputFiles=3 tiles=3 largeImages=3 uploading=0 send=ready testId=send-button ariaLabel="Send" stop=false editorChars=8 userMessages=1 alert="" uploadPath=native');
  });

  test('returns a safe error result when page evaluation throws', async () => {
    const result = await readComposerState({
      evaluate: async () => { throw new Error('probe unavailable'); }
    }, { uploadPath: 'fallback' });

    expect(result).toEqual({ error: 'probe unavailable' });
  });

  test('keeps only counts, flags, URL, and trimmed alert text', async () => {
    const result = await readComposerState({
      evaluate: async () => ({
        url: 'https://chatgpt.com/c/123',
        fileInputs: 1,
        markedInputFiles: 2,
        tiles: 2,
        largeImages: 2,
        uploading: 1,
        send: { found: true, disabled: false, testId: 'send-button', ariaLabel: 'Send', text: 'private button copy' },
        stop: false,
        editorChars: 12,
        userMessages: 4,
        alert: '  Upload failed.  ',
        editorText: 'private prompt text',
        messageText: 'private conversation text'
      })
    }, { uploadPath: 'native' });

    expect(result).toEqual({
      url: 'https://chatgpt.com/c/123',
      fileInputs: 1,
      markedInputFiles: 2,
      tiles: 2,
      largeImages: 2,
      uploading: 1,
      send: { found: true, disabled: false, testId: 'send-button', ariaLabel: 'Send' },
      stop: false,
      editorChars: 12,
      userMessages: 4,
      alert: 'Upload failed.',
      uploadPath: 'native'
    });
  });
});
