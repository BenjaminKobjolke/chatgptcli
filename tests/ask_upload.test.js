import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachImages } from '../src/commands/ask_upload.js';
import { askOnPage, shouldRetry } from '../src/commands/ask_page.js';
import { STOP_SELECTOR } from '../src/commands/chatgpt_surface.js';

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakePage({ inputFound = true, previews = true, readyAt = 3, bridge = true, assignResult = { ok: true } } = {}) {
  const calls = [];
  let readyPolls = 0;
  let clicked = false;
  let insertedPrompt = '';
  const page = {
    calls,
    goto: async () => {},
    wait: async () => { calls.push('wait'); },
    insertText: async (text) => { insertedPrompt = text; calls.push('insertText'); },
    setFileInput: bridge ? async (paths, selector) => calls.push(['setFileInput', paths, selector]) : undefined,
    pressKey: async () => {},
    evaluate: async (script) => {
      if (script.includes('/api/auth/session')) {
        return { url: 'https://chatgpt.com/', editorFound: true, sendFound: true, loggedIn: true };
      }
      if (script.includes('__chatgptcliIdleProbe')) {
        calls.push('idleProbe');
        return false;
      }
      if (script.includes('delete window.__chatgptcliFileChunks')) {
        calls.push(['cleanup', script]);
        return true;
      }
      if (script.includes('__chatgptcliFileChunks')) {
        calls.push(['inject', script]);
        return script.includes('dataset.chatgptcliAssigned') ? assignResult : true;
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
      if (script.includes('url: window.location.href')) {
        return { url: 'https://chatgpt.com/', userMessageCount: 0 };
      }
      if (script.includes('assistants:')) return { assistants: [], userMessageCount: 0 };
      if (script.includes('send.click()')) {
        clicked = true;
        calls.push('click');
        return { ok: true };
      }
      if (script.includes('const assistants')) {
        return {
          assistants: clicked ? [{ key: 'new', text: 'Here is the answer.' }] : [],
          streaming: false,
          userMessageCount: clicked ? 1 : 0,
          lastUserText: clicked ? insertedPrompt : ''
        };
      }
      if (script.includes('userMessageCount')) {
        return { editorFound: true, editorText: '', stopPresent: true, userMessageCount: 1, url: 'https://chatgpt.com/' };
      }
      if (script.includes('editor.focus()')) return { ok: true };
      return [];
    }
  };
  if (bridge === 'not-allowed') page.setFileInput = async () => { throw new Error('{"code":-32000,"message":"Not allowed"}'); };
  if (bridge === 'socket') page.setFileInput = async () => { throw new Error('socket hang up'); };
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

    expect(result).toEqual({ ok: true, uploadPath: 'native' });
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
    expect(page.calls.find((call) => Array.isArray(call) && call[0] === 'setFileInput')).toEqual(['setFileInput', ['a.png', 'b.jpg'], '[data-chatgptcli-file-input="1"]']);
    expect(page.calls.indexOf('idleProbe')).toBeLessThan(page.calls.indexOf('findFileInput'));
    expect(page.calls.indexOf('findFileInput')).toBeLessThan(page.calls.indexOf('insertText'));
    expect(page.calls.filter((call) => call === 'sendReady')).toHaveLength(3);
  });

  test('does not attach or type when the previous reply is still generating', async () => {
    const originalNow = Date.now;
    let now = 0;
    Date.now = () => now++ * 1000;
    const page = fakePage();
    const evaluate = page.evaluate;
    page.evaluate = async (script) => {
      if (script.includes('__chatgptcliIdleProbe')) return true;
      if (script.includes('const largeImages')) {
        return { url: 'https://chatgpt.com/c/123', stop: true, stopLabel: 'Stop generating' };
      }
      return evaluate(script);
    };
    try {
      const result = await askOnPage(page, {
        prompt: 'Review this', images: ['a.png'], timeoutMs: 1000, newChat: true
      });

      expect(result.response).toStartWith('[SEND FAILED] previous reply is still generating');
      expect(result.response).toContain('composer:');
      expect(result.response).toContain('stop=true stopLabel="Stop generating"');
      expect(page.calls).not.toContain('findFileInput');
      expect(page.calls).not.toContain('insertText');
    } finally {
      Date.now = originalNow;
    }
  });

  test('reports when the composer has no file input', async () => {
    const page = fakePage({ inputFound: false });
    const result = await askOnPage(page, { prompt: 'Review', images: ['a.png'], timeoutMs: 1000, newChat: true });
    expect(result.response).toBe('[UPLOAD FAILED] composer file input not found');
    expect(page.calls.some((call) => Array.isArray(call) && call[0] === 'setFileInput')).toBe(false);
  });

  test('reports a missing bridge file upload capability', async () => {
    const page = fakePage({ bridge: false });
    const imagePath = createTempImage('a.png', Buffer.from('image'));
    const result = await attachImages(page, [imagePath]);
    expect(result).toEqual({ ok: true, uploadPath: 'fallback' });
    expect(page.calls.some((call) => Array.isArray(call) && call[0] === 'inject')).toBe(true);
  });

  test('falls back after Not allowed and stages a large image in bounded chunks', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chatgptcli-upload-'));
    tempDirectories.push(directory);
    const imagePath = join(directory, 'large.png');
    const imageBytes = Buffer.alloc(400 * 1024, 23);
    writeFileSync(imagePath, imageBytes);
    const page = fakePage({ bridge: 'not-allowed' });
    const result = await attachImages(page, [imagePath]);

    expect(result).toEqual({ ok: true, uploadPath: 'fallback' });
    const stagingScripts = page.calls.filter((call) => Array.isArray(call) && call[0] === 'inject' && !call[1].includes('dataset.chatgptcliAssigned'));
    const assignScripts = page.calls.filter((call) => Array.isArray(call) && call[0] === 'inject' && call[1].includes('dataset.chatgptcliAssigned'));
    const injectedScripts = page.calls.filter((call) => Array.isArray(call) && call[0] === 'inject');
    expect(stagingScripts).toHaveLength(3);
    expect(injectedScripts.every(([, script]) => Buffer.byteLength(script) < 1024 * 1024)).toBe(true);
    const base64 = stagingScripts.map(([, script]) => script.match(/\[\d+\]\[\d+\] = ("[^"]+")/)?.[1]).map((chunk) => JSON.parse(chunk)).join('');
    expect(Buffer.from(base64, 'base64')).toEqual(imageBytes);
    expect(assignScripts).toHaveLength(1);
    expect(assignScripts[0][1]).toContain('large.png');
    expect(assignScripts[0][1]).toContain('image/png');
    expect(page.calls).toContain('findFileInput');
    expect(page.calls.some((call) => call === 'wait' || Array.isArray(call) && call[0] === 'wait')).toBe(true);
  });

  test('assigns files again on a later fallback upload in the same composer', async () => {
    const firstImage = createTempImage('first.png', Buffer.from('first image'));
    const secondImage = createTempImage('second.png', Buffer.from('second image'));
    const page = fallbackPage();

    expect(await attachImages(page, [firstImage])).toEqual({ ok: true, uploadPath: 'fallback' });
    expect(await attachImages(page, [secondImage])).toEqual({ ok: true, uploadPath: 'fallback' });

    expect(page.input.files.map((file) => file.name)).toEqual(['second.png']);
    expect(page.changeEvents).toBe(4);
  });

  test('keeps a repeated fallback assignment from dispatching twice in one upload', async () => {
    const imagePath = createTempImage('once.png', Buffer.from('image'));
    const page = fallbackPage();

    expect(await attachImages(page, [imagePath])).toEqual({ ok: true, uploadPath: 'fallback' });
    const assignedFiles = page.input.files;
    const changeEvents = page.changeEvents;
    expect(await page.evaluate(page.assignScript)).toEqual({ ok: true });

    expect(page.input.files).toBe(assignedFiles);
    expect(page.changeEvents).toBe(changeEvents);
  });

  test('reports fallback input state immediately after the change event', async () => {
    const imagePath = createTempImage('cleared.png', Buffer.from('image'));
    const page = fallbackPage({ previews: false, clearFilesOnChange: true });

    const result = await attachImages(page, [imagePath]);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('assignmentAfterChange=connected/present/0');
    expect(result.reason).toContain('handlerFound=false dispatchPath=events');
    expect(result.reason).toContain('stages=assigned:connected/present/1,handlerEntry:connected/present/1,handlerExit:connected/present/0,afterHandlerReturn:connected/present/0');
  });

  test('records fallback assignment snapshots around a React change handler', async () => {
    const imagePath = createTempImage('react.png', Buffer.from('image'));
    const page = fallbackPage({ previews: false, reactHandler: true });

    const result = await attachImages(page, [imagePath]);

    expect(result.reason).toContain('handlerFound=true dispatchPath=react');
    expect(result.reason).toContain('handlerReadsFiles=true handlerClearsValue=true handlerError=none');
    expect(result.reason).toContain('busyAtAssign=false');
    expect(result.reason).toContain('stages=assigned:connected/present/1,handlerEntry:connected/present/1,handlerExit:connected/present/1,afterHandlerReturn:connected/present/1');
  });

  test('detects a minified React handler that clears the input value', async () => {
    const imagePath = createTempImage('minified.png', Buffer.from('image'));
    const page = fallbackPage({ previews: false, reactHandler: 'minified' });

    const result = await attachImages(page, [imagePath]);

    expect(result.reason).toContain('handlerClearsValue=true');
    expect(result.reason).toContain('busyAtAssign=false');
  });

  test('does not fall back for unrelated bridge errors', async () => {
    const page = fakePage({ bridge: 'socket' });
    const result = await attachImages(page, ['a.png']);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('socket hang up');
    expect(page.calls.some((call) => Array.isArray(call) && call[0] === 'inject')).toBe(false);
  });

  test('reports fallback errors with file access guidance', async () => {
    const imagePath = createTempImage('a.png', Buffer.from('image'));
    const result = await attachImages(fakePage({ bridge: 'not-allowed', assignResult: { ok: false, reason: 'file input not found' } }), [imagePath]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('file input not found');
    expect(result.reason).toContain('Allow access to file URLs');
  });

  test('reports when previews do not appear', async () => {
    const result = await askOnPage(fakePage({ previews: false }), { prompt: 'Review', images: ['a.png'], timeoutMs: 1000, newChat: true });
    expect(result.response).toStartWith('[UPLOAD FAILED] image preview did not appear');
    expect(result.response).toContain('composer:');
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

function createTempImage(name, bytes) {
  const directory = mkdtempSync(join(tmpdir(), 'chatgptcli-upload-'));
  tempDirectories.push(directory);
  const imagePath = join(directory, name);
  writeFileSync(imagePath, bytes);
  return imagePath;
}

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

function fallbackPage({ previews = true, clearFilesOnChange = false, reactHandler = false } = {}) {
  const attributes = {};
  const dataset = {};
  const input = {
    accept: 'image/*',
    multiple: true,
    disabled: false,
    attributes,
    dataset,
    files: [],
    isConnected: true,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
    setAttribute: (name, value) => {
      attributes[name] = value;
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        dataset[key] = value;
      }
    },
    removeAttribute: (name) => {
      delete attributes[name];
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        delete dataset[key];
      }
    },
    dispatchEvent: (event) => {
      page.changeEvents += 1;
      if (clearFilesOnChange && event.type === 'change') input.files = [];
    }
  };
  if (reactHandler) {
    input.__reactProps$test = { onChange: reactHandler === 'minified'
      ? new Function('event', 'event.target.files;event.target.value=""')
      : (event) => {
        void event.target.files;
        event.target.value = '';
      } };
  }
  const form = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'input[type="file"]' ? [input] : []
  };
  const editor = { closest: () => form };
  const document = {
    querySelector: (selector) => selector === STOP_SELECTOR
      ? null
      : selector.includes('data-chatgptcli-file-input') ? input : editor,
    querySelectorAll: (selector) => {
      if (selector === 'img[src], canvas') return [];
      if (selector === '[data-chatgptcli-file-input="1"]') {
        return Object.hasOwn(attributes, 'data-chatgptcli-file-input') ? [input] : [];
      }
      if (selector === '[data-chatgptcli-assigned]') {
        return Object.hasOwn(dataset, 'chatgptcliAssigned') ? [input] : [];
      }
      return [];
    }
  };
  const window = {};
  class FakeFile {
    constructor(_parts, name, options) {
      this.name = name;
      this.type = options.type;
    }
  }
  class FakeDataTransfer {
    constructor() {
      const files = [];
      this.items = { add: (file) => files.push(file) };
      Object.defineProperty(this, 'files', { get: () => files });
    }
  }
  const page = {
    input,
    changeEvents: 0,
    assignScript: '',
    wait: async () => {},
    setFileInput: async () => { throw new Error('Not allowed'); },
    evaluate: async (script) => {
      if (script.includes('delete window.__chatgptcliFileChunks')) {
        delete window.__chatgptcliFileChunks;
        return true;
      }
      if (script.includes('const names =')) return previews;
      if (script.includes('const tiles = form ? Array.from')) {
        return {
          url: 'https://chatgpt.com/', fileInputs: 1, markedInputFiles: input.files.length,
          tiles: 0, largeImages: 0, uploading: 0,
          send: { found: false, disabled: false, testId: '', ariaLabel: '' },
          stop: false, editorChars: 0, userMessages: 0, alert: ''
        };
      }
      if (script.includes('dataset.chatgptcliAssigned')) page.assignScript = script;
      return Function('document', 'window', 'DataTransfer', 'File', 'atob', 'Event', `return ${script}`)(
        document,
        window,
        FakeDataTransfer,
        FakeFile,
        atob,
        class FakeEvent { constructor(type) { this.type = type; } }
      );
    }
  };
  return page;
}
