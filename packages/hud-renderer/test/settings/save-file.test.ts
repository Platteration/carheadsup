import { describe, expect, it, vi } from 'vitest';
import { isAndroidWebView, saveTextFile } from '../../src/settings/ui/save-file.ts';
import type { SaveEnvironment } from '../../src/settings/ui/save-file.ts';

const WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function env(userAgent: string, extra: Partial<SaveEnvironment> = {}): SaveEnvironment {
  return {
    userAgent,
    copy: vi.fn(async () => true),
    download: vi.fn(),
    ...extra,
  };
}

describe('saving the trips CSV', () => {
  it('recognises the companion app’s WebView', () => {
    expect(isAndroidWebView(WEBVIEW)).toBe(true);
    expect(isAndroidWebView(CHROME_ANDROID)).toBe(false);
    expect(isAndroidWebView(DESKTOP)).toBe(false);
  });

  it('downloads in browsers', async () => {
    for (const ua of [DESKTOP, CHROME_ANDROID]) {
      const e = env(ua);
      expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', e)).toBe('downloaded');
      expect(e.download).toHaveBeenCalledWith('a,b', 'trips.csv', 'text/csv');
    }
  });

  it('never relies on a download in the WebView: share sheet first, else the clipboard', async () => {
    const shareFile = vi.fn(async () => undefined);
    const shared = env(WEBVIEW, { shareFile, canShareFile: () => true });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', shared)).toBe('shared');
    expect(shareFile).toHaveBeenCalledTimes(1);
    expect(shared.download).not.toHaveBeenCalled();

    const plain = env(WEBVIEW);
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', plain)).toBe('copied');
    expect(plain.copy).toHaveBeenCalledWith('a,b');
    expect(plain.download).not.toHaveBeenCalled();

    const refused = env(WEBVIEW, {
      shareFile: async () => {
        throw new DOMException('not allowed', 'NotAllowedError');
      },
    });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', refused)).toBe('copied');

    const cancelled = env(WEBVIEW, {
      shareFile: async () => {
        throw new DOMException('closed', 'AbortError');
      },
    });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', cancelled)).toBe('cancelled');
    expect(cancelled.copy).not.toHaveBeenCalled();

    const nothing = env(WEBVIEW, { copy: async () => false });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', nothing)).toBe('failed');
  });

  it('in the companion app, hands the file to its bridge first', async () => {
    const saved = env(WEBVIEW, { nativeSave: vi.fn(() => 'saved' as const), shareFile: vi.fn() });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', saved)).toBe('saved');
    expect(saved.nativeSave).toHaveBeenCalledWith('a,b', 'trips.csv', 'text/csv');
    expect(saved.shareFile).not.toHaveBeenCalled();
    expect(saved.copy).not.toHaveBeenCalled();

    // Older Android versions: the app opens its share sheet.
    const shared = env(WEBVIEW, { nativeSave: () => 'shared' });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', shared)).toBe('shared');
    expect(shared.copy).not.toHaveBeenCalled();

    // The bridge could not save (or broke): the usual fallbacks.
    const failed = env(WEBVIEW, { nativeSave: () => 'failed' });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', failed)).toBe('copied');
    const broken = env(WEBVIEW, {
      nativeSave: () => {
        throw new Error('Java exception');
      },
    });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', broken)).toBe('copied');

    // Browsers never use it (a page elsewhere cannot have it anyway).
    const browser = env(DESKTOP, { nativeSave: vi.fn(() => 'saved' as const) });
    expect(await saveTextFile('a,b', 'trips.csv', 'text/csv', browser)).toBe('downloaded');
    expect(browser.nativeSave).not.toHaveBeenCalled();
  });
});
