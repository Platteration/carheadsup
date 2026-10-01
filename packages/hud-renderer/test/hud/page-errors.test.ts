import {
  CLIENT_ERROR_MESSAGE_CHARS,
  CLIENT_ERROR_STACK_CHARS,
  RENDERER_FRAME_CHARS,
  parseRendererMessage,
} from '@carheadsup/core';
import type { RendererToServer } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  PAGE_ERROR_BURST,
  PAGE_ERROR_REFILL_MS,
  PageErrorReporter,
  clientErrorMessage,
  reportUncaughtErrors,
} from '../../src/hud/page-errors.ts';

describe('clientErrorMessage', () => {
  it('carries the message and the stack trace of an Error', () => {
    const error = new TypeError('x is undefined');
    error.stack = 'TypeError: x is undefined\n    at render (hud.js:1:2)';
    expect(clientErrorMessage(error)).toEqual({
      t: 'client-error',
      message: 'x is undefined',
      stack: 'TypeError: x is undefined\n    at render (hud.js:1:2)',
    });
  });

  it('describes thrown values that are no Error', () => {
    expect(clientErrorMessage('plain text')).toEqual({
      t: 'client-error',
      message: 'plain text',
      stack: null,
    });
    expect(clientErrorMessage({ code: 7 }).message).toBe('{"code":7}');
    expect(clientErrorMessage(undefined).message).toBe('undefined');
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(clientErrorMessage(cyclic).message).toBe('[object Object]');
  });

  it('is always a message the server accepts', () => {
    const cases: unknown[] = [
      Object.assign(new Error('a\u0000b\u001bc'), { stack: 'x\u0007y\nz' }),
      Object.assign(new Error('m'.repeat(5000)), { stack: 's'.repeat(10_000) }),
      // Every character of the stack doubles in JSON.
      Object.assign(new Error('"'.repeat(CLIENT_ERROR_MESSAGE_CHARS)), {
        stack: '\\'.repeat(CLIENT_ERROR_STACK_CHARS),
      }),
      // Only the message, but escapes all the way.
      '"'.repeat(10_000),
      // A surrogate pair across the cut.
      Object.assign(new Error('x'), { stack: `${'s'.repeat(CLIENT_ERROR_STACK_CHARS - 1)}😀` }),
      new Error(''),
    ];
    for (const error of cases) {
      const message = clientErrorMessage(error);
      const json = JSON.stringify(message);
      expect(json.length).toBeLessThanOrEqual(RENDERER_FRAME_CHARS);
      const parsed = parseRendererMessage(json);
      expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
      expect(message.message).not.toBe('');
      expect(message.stack ?? '').not.toMatch(/[\ud800-\udbff]$/);
    }
  });
});

describe('PageErrorReporter', () => {
  it('sends a few at once, then one per refill period', () => {
    let now = 0;
    const sent: RendererToServer[] = [];
    const reporter = new PageErrorReporter({ now: () => now });
    reporter.setSender((m) => sent.push(m) > 0);
    for (let i = 0; i < 6; i += 1) reporter.report(new Error(`e${i}`));
    expect(sent.map((m) => (m.t === 'client-error' ? m.message : m.t))).toEqual(
      Array.from({ length: PAGE_ERROR_BURST }, (_, i) => `e${i}`),
    );
    now += PAGE_ERROR_REFILL_MS;
    reporter.report(new Error('later'));
    reporter.report(new Error('too soon'));
    expect(sent).toHaveLength(PAGE_ERROR_BURST + 1);
    expect(sent.at(-1)).toMatchObject({ message: 'later' });
  });

  it('keeps errors while not connected and sends them once it is', () => {
    const sent: RendererToServer[] = [];
    let open = false;
    const reporter = new PageErrorReporter({ now: () => 0 });
    const send = (m: RendererToServer): boolean => open && sent.push(m) > 0;
    reporter.report(new Error('before'));
    reporter.setSender(send);
    expect(sent).toEqual([]);
    open = true;
    reporter.setSender(send);
    expect(sent).toEqual([expect.objectContaining({ message: 'before' })]);
  });
});

describe('reportUncaughtErrors', () => {
  it('reports uncaught exceptions and unhandled rejections, not resource load failures', () => {
    const target = new EventTarget();
    const sent: RendererToServer[] = [];
    const reporter = new PageErrorReporter({ now: () => 0 });
    reporter.setSender((m) => sent.push(m) > 0);
    const remove = reportUncaughtErrors(reporter, target);

    target.dispatchEvent(
      Object.assign(new Event('error'), { error: new Error('thrown'), message: 'Uncaught thrown' }),
    );
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'rejected' }));
    target.dispatchEvent(new Event('error'));
    expect(sent.map((m) => (m.t === 'client-error' ? m.message : m.t))).toEqual([
      'thrown',
      'rejected',
    ]);
    remove();
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'gone' }));
    expect(sent).toHaveLength(2);
  });
});
