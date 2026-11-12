import { describe, expect, test } from 'bun:test';
import { attachImages } from '../src/commands/ask_upload.js';
import { askOnPage, shouldRetry } from '../src/commands/ask_page.js';

function fakePage({ inputFound = true, previews = true, readyAt = 3, bridge = true } = {}) {
  const calls = [];
  let readyPolls = 0;
  let clicked = false;
  const page = {
    calls,
    goto: async () => {},
    wait: async () => {},
    insertText: async () => { calls.push('insertText'); },
    setFileInput: bridge ? async (paths, selector) => calls.push(['setFileInput', paths, selector]) : undefined,
    pressKey: async () => {},
    evaluate: async (script) => {
      if (script.includes('/api/auth/session')) {
        return { url: 'https://chatgpt.com/', editorFound: true, sendFound: true, loggedIn: true };
      }
      if (script.includes('data-chatgptcli-file-input')) {
        calls.push('findFileInput');
        return { ok: inputFound, reason: inputFound ? undefined : 'composer file input not found' };
      }
      if (script.includes('data-composer-attachments')) return previews;
      if (script.includes('sendReady')) {
        readyPolls += 1;
        calls.push('sendReady');
        return { editorText: 'question', sendReady: readyPolls >= readyAt, userMessageCount: 0 };
      }
      if (script.includes('send.click()')) {
        clicked = true;
        calls.push('click');
        return { ok: true };
      }
      if (script.includes('const assistants')) {
        return { assistants: clicked ? [{ key: 'new', text: 'Here is the answer.' }] : [], streaming: false };
      }
      if (script.includes('userMessageCount')) {
        return { editorFound: true, editorText: '', stopPresent: true, userMessageCount: 1, url: 'https://chatgpt.com/' };
      }
      if (script.includes('editor.focus()')) return { ok: true };
      return [];
    }
  };
  if (bridge === 'throws') page.setFileInput = async () => { throw new Error('not supported'); };
  return page;
}

describe('ask image uploads', () => {
  test('selects the image-only input when the composer has multiple file inputs', async () => {
    const inputs = [
      fakeFileInput('image/*,video/*'),
      fakeFileInput('image/*')
    ];
    const form = { querySelectorAll: () => inputs };
    const document = {
      querySelector: () => ({ closest: () => form }),
      querySelectorAll: () => []
    };
    let selected;
    const page = {
      evaluate: async (script) => {
        if (script.includes('const names =')) return true;
        return Function('document', `return ${script}`)(document);
      },
      setFileInput: async (_paths, selector) => {
        const attribute = selector.match(/\[([^=]+)/)[1];
        selected = inputs.find((input) => input.attributes[attribute] === '1');
      },
      wait: async () => {}
    };

    const result = await attachImages(page, ['one.png']);

    expect(result).toEqual({ ok: true });
    expect(selected).toBe(inputs[1]);
  });

  test('keeps equally specific matching file inputs ambiguous', async () => {
    const inputs = [fakeFileInput('image/*'), fakeFileInput('image/*')];
    const form = { querySelectorAll: () => inputs };
    const document = {
      querySelector: () => ({ closest: () => form }),
      querySelectorAll: () => []
    };
    const page = {
      evaluate: async (script) => Function('document', `return ${script}`)(document)
    };

    const result = await attachImages(page, ['one.png']);

    expect(result).toEqual({ ok: false, reason: 'composer file input is ambiguous' });
  });

  test('uploads before typing and waits for previews and send readiness', async () => {
    const page = fakePage();
    const result = await askOnPage(page, { prompt: 'Review these', images: ['a.png', 'b.jpg'], timeoutMs: 1000, newChat: true });
    expect(result.response).toBe('Here is the answer.');
    expect(page.calls[1]).toEqual(['setFileInput', ['a.png', 'b.jpg'], '[data-chatgptcli-file-input="1"]']);
    expect(page.calls.indexOf('findFileInput')).toBeLessThan(page.calls.indexOf('insertText'));
    expect(page.calls.filter((call) => call === 'sendReady')).toHaveLength(3);
  });

  test('reports when the composer has no file input', async () => {
    const page = fakePage({ inputFound: false });
    const result = await askOnPage(page, { prompt: 'Review', images: ['a.png'], timeoutMs: 1000, newChat: true });
    expect(result.response).toBe('[UPLOAD FAILED] composer file input not found');
    expect(page.calls.some((call) => Array.isArray(call) && call[0] === 'setFileInput')).toBe(false);
  });

  test('reports a missing bridge file upload capability', async () => {
    const result = await askOnPage(fakePage({ bridge: false }), { prompt: 'Review', images: ['a.png'], timeoutMs: 1000, newChat: true });
    expect(result.response).toContain('[UPLOAD FAILED]');
    expect(result.response).toContain('update the OpenCLI extension');
  });

  test('reports bridge upload errors with extension guidance', async () => {
    const result = await askOnPage(fakePage({ bridge: 'throws' }), { prompt: 'Review', images: ['a.png'], timeoutMs: 1000, newChat: true });
    expect(result.response).toContain('[UPLOAD FAILED]');
    expect(result.response).toContain('not supported');
  });

  test('reports when previews do not appear', async () => {
    const result = await askOnPage(fakePage({ previews: false }), { prompt: 'Review', images: ['a.png'], timeoutMs: 1000, newChat: true });
    expect(result.response).toContain('[UPLOAD FAILED] image preview did not appear');
  });

  test('does not click send when upload readiness times out', async () => {
    const page = fakePage({ readyAt: Infinity });
    const result = await askOnPage(page, { prompt: 'Review', images: ['a.png'], timeoutMs: 1000, newChat: true });
    expect(result.response).toContain('[UPLOAD FAILED] upload did not finish within');
    expect(result.response).toContain('60 s');
    expect(page.calls).not.toContain('click');
  });

  test('retries upload failures', () => {
    expect(shouldRetry('[UPLOAD FAILED] upload did not finish')).toBe(true);
  });

  test('does not use file upload for a text-only prompt', async () => {
    const page = fakePage({ readyAt: 1 });
    const result = await askOnPage(page, { prompt: 'Review', images: [], timeoutMs: 1000, newChat: true });
    expect(result.response).toBe('Here is the answer.');
    expect(page.calls.some((call) => Array.isArray(call) && call[0] === 'setFileInput')).toBe(false);
    expect(page.calls.filter((call) => call === 'sendReady')).toHaveLength(1);
  });
});

function fakeFileInput(accept) {
  const attributes = {};
  return {
    accept,
    multiple: true,
    disabled: false,
    attributes,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
    setAttribute: (name, value) => { attributes[name] = value; },
    removeAttribute: (name) => { delete attributes[name]; }
  };
}
