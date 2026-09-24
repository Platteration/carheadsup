import { copyText } from './hooks.ts';

/**
 * Saving a generated file (the trips CSV) from the settings app. A browser takes a blob
 * download, but the companion app's Android WebView silently drops downloads it has no handler
 * for — and cannot hand a `blob:` URL to the system anyway. There the file goes to the app's
 * bridge (`window.CarheadsupAndroid.saveFile`: the phone's Downloads, or its share sheet on
 * Android 9 and older) when it has one, else to the share sheet when the WebView offers one,
 * else to the clipboard, and the person is told which.
 */

export type FileSaveOutcome = 'downloaded' | 'saved' | 'shared' | 'cancelled' | 'copied' | 'failed';

/** What the companion app's bridge did with the file. */
export type NativeSaveResult = 'saved' | 'shared' | 'failed';

export interface SaveEnvironment {
  userAgent: string;
  /** The companion app's bridge, when the page runs in its WebView. */
  nativeSave?: (text: string, filename: string, type: string) => NativeSaveResult;
  /** Web Share with files, when available. */
  shareFile?: (file: File) => Promise<void>;
  canShareFile?: (file: File) => boolean;
  copy: (text: string) => Promise<boolean>;
  download: (text: string, filename: string, type: string) => void;
}

/** Android WebViews say "; wv)" in their user agent; Chrome and other browsers do not. */
export function isAndroidWebView(userAgent: string): boolean {
  return /Android/.test(userAgent) && /; wv\)/.test(userAgent);
}

/** Save `text` as a file (blob download; works for authenticated requests). */
export function downloadText(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The object the companion app injects into its WebView (`addJavascriptInterface`). */
interface AndroidBridge {
  saveFile(text: string, filename: string, type: string): unknown;
}

function androidBridge(): AndroidBridge | null {
  const bridge = (globalThis as { CarheadsupAndroid?: Partial<AndroidBridge> }).CarheadsupAndroid;
  return typeof bridge?.saveFile === 'function' ? (bridge as AndroidBridge) : null;
}

function browserEnvironment(): SaveEnvironment {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const bridge = androidBridge();
  const share = nav && typeof nav.share === 'function' ? nav.share.bind(nav) : null;
  const canShare = nav && typeof nav.canShare === 'function' ? nav.canShare.bind(nav) : null;
  return {
    userAgent: nav?.userAgent ?? '',
    ...(bridge
      ? {
          // Called on the bridge object: a Java bridge method cannot be detached from it.
          nativeSave: (text: string, filename: string, type: string): NativeSaveResult => {
            const result = bridge.saveFile(text, filename, type);
            return result === 'saved' || result === 'shared' ? result : 'failed';
          },
        }
      : {}),
    ...(share ? { shareFile: (file: File) => share({ files: [file], title: file.name }) } : {}),
    ...(canShare ? { canShareFile: (file: File) => canShare({ files: [file] }) } : {}),
    copy: copyText,
    download: downloadText,
  };
}

/** Save a text file the best way this page can (see the module comment). */
export async function saveTextFile(
  text: string,
  filename: string,
  type: string,
  env: SaveEnvironment = browserEnvironment(),
): Promise<FileSaveOutcome> {
  if (!isAndroidWebView(env.userAgent)) {
    env.download(text, filename, type);
    return 'downloaded';
  }
  if (env.nativeSave) {
    try {
      const result = env.nativeSave(text, filename, type);
      if (result !== 'failed') return result;
    } catch {
      // An older app without a working bridge: fall back below.
    }
  }
  if (env.shareFile && typeof File === 'function') {
    const file = new File([text], filename, { type });
    if (env.canShareFile?.(file) ?? true) {
      try {
        await env.shareFile(file);
        return 'shared';
      } catch (error) {
        // The person closed the share sheet: nothing more to do.
        if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
        // Refused (no user activation left, file type not allowed): try the clipboard.
      }
    }
  }
  return (await env.copy(text)) ? 'copied' : 'failed';
}
