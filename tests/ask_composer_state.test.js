import { describe, expect, test } from 'bun:test';
import { formatComposerState, readComposerState, waitForComposerIdle } from '../src/commands/ask_composer_state.js';

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
      stopLabel: '',
      editorChars: 8,
      userMessages: 1,
      alert: '',
      uploadPath: 'native'
    })).toBe('url=https://chatgpt.com/c/123 fileInputs=2 markedInputFiles=3 tiles=3 largeImages=3 uploading=0 send=ready testId=send-button ariaLabel="Send" stop=false stopLabel="" editorChars=8 userMessages=1 alert="" uploadPath=native');
  });

  test('waits until the stop button disappears', async () => {
    const calls = [];
    let probes = 0;
    const page = {
      evaluate: async (script) => {
        if (script.includes('__chatgptcliIdleProbe')) {
          probes += 1;
          return probes === 1;
        }
        calls.push('snapshot');
        return {};
      },
      wait: async (seconds) => calls.push(seconds)
    };

    await expect(waitForComposerIdle(page, 100)).resolves.toEqual({ idle: true });
    expect(probes).toBe(2);
    expect(calls).toEqual([1]);
  });

  test('returns idle immediately when the stop button is absent', async () => {
    let probes = 0;
    const result = await waitForComposerIdle({
      evaluate: async (script) => {
        expect(script).toContain('__chatgptcliIdleProbe');
        probes += 1;
        return false;
      }
    }, 100);

    expect(result).toEqual({ idle: true });
    expect(probes).toBe(1);
  });

  test('returns a composer snapshot when the stop button remains visible', async () => {
    const originalNow = Date.now;
    let now = 0;
    Date.now = () => now++;
    try {
      const result = await waitForComposerIdle({
        evaluate: async (script) => script.includes('__chatgptcliIdleProbe')
          ? true
          : ({ url: 'https://chatgpt.com/c/123', stop: true, stopLabel: 'Stop generating' }),
        wait: async () => {}
      }, 2);

      expect(result.idle).toBe(false);
      expect(result.snapshot.stop).toBe(true);
      expect(result.snapshot.stopLabel).toBe('Stop generating');
    } finally {
      Date.now = originalNow;
    }
  });

  test('treats an idle probe error as idle', async () => {
    await expect(waitForComposerIdle({ evaluate: async () => { throw new Error('probe unavailable'); } }, 100))
      .resolves.toEqual({ idle: true });
  });

  test('normalizes and trims the stop label in the snapshot', async () => {
    const state = await readComposerState({
      evaluate: async () => ({ stop: true, stopLabel: ` ${'x'.repeat(80)} ` })
    });

    expect(state.stopLabel).toBe('x'.repeat(60));
    expect(formatComposerState(state)).toContain(`stopLabel="${'x'.repeat(60)}"`);
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
      stopLabel: '',
      editorChars: 12,
      userMessages: 4,
      alert: 'Upload failed.',
      uploadPath: 'native'
    });
  });
});
