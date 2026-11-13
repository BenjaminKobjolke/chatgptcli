import { describe, expect, test } from 'bun:test';
import { VISIBLE_STOP_EXPRESSION } from '../src/commands/chatgpt_surface.js';
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
      stopTestId: '',
      stopInForm: false,
      stopVisible: false,
      stopMatches: 0,
      editorChars: 8,
      userMessages: 1,
      alert: '',
      uploadPath: 'native'
    })).toBe('url=https://chatgpt.com/c/123 fileInputs=2 markedInputFiles=3 tiles=3 largeImages=3 uploading=0 send=ready testId=send-button ariaLabel="Send" stop=false stopLabel="" stopTestId="" stopInForm=false stopVisible=false stopMatches=0 editorChars=8 userMessages=1 alert="" uploadPath=native');
  });

  test('counts only rendered stop controls as visible', () => {
    const controls = [
      { getClientRects: () => [] },
      { getClientRects: () => [{ width: 1, height: 1 }] }
    ];
    const result = Function('document', `return ${VISIBLE_STOP_EXPRESSION}`)({
      querySelectorAll: () => controls
    });

    expect(result).toBe(true);
    expect(Function('document', `return ${VISIBLE_STOP_EXPRESSION}`)({
      querySelectorAll: () => [controls[0]]
    })).toBe(false);
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

  test('uses the visible stop control for all stop diagnostics', async () => {
    let stateScript = '';
    await readComposerState({
      evaluate: async (script) => {
        stateScript = script;
        return {};
      }
    });

    expect(stateScript).toContain("stopLabel: (diagnosticStop?.getAttribute('aria-label')");
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
        stopTestId: 'stop-button',
        stopInForm: true,
        stopVisible: true,
        stopMatches: 2,
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
      stopTestId: 'stop-button',
      stopInForm: true,
      stopVisible: true,
      stopMatches: 2,
      editorChars: 12,
      userMessages: 4,
      alert: 'Upload failed.',
      uploadPath: 'native'
    });
  });

  test('uses safe defaults for missing stop diagnostics', async () => {
    const state = await readComposerState({ evaluate: async () => ({ stop: true }) });

    expect(state.stopTestId).toBe('');
    expect(state.stopInForm).toBe(false);
    expect(state.stopVisible).toBe(false);
    expect(state.stopMatches).toBe(0);
  });

  test('normalizes stop diagnostics and caps the test id at 60 characters', async () => {
    const state = await readComposerState({
      evaluate: async () => ({
        stopTestId: 'x'.repeat(80),
        stopInForm: 1,
        stopVisible: true,
        stopMatches: '3'
      })
    });

    expect(state.stopTestId).toBe('x'.repeat(60));
    expect(state.stopInForm).toBe(true);
    expect(state.stopVisible).toBe(true);
    expect(state.stopMatches).toBe(3);
    expect(formatComposerState(state)).toContain(`stopTestId="${'x'.repeat(60)}" stopInForm=true stopVisible=true stopMatches=3`);
  });
});
