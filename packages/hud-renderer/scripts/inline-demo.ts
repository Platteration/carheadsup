/**
 * Second half of `npm run build:demo`: folds Vite's demo build (`dist-demo/demo.html` with one
 * script and one stylesheet; the fonts are already data: URIs) into single files that load
 * nothing from anywhere:
 *
 *  - `dist-demo/index.html` — a complete document, for opening from disk or any static host;
 *  - `dist-demo/artifact.html` — the same page as a fragment for hosts that wrap it in their own
 *    document skeleton (charset, viewport, a small reset): no doctype, `<html>`, `<head>` or
 *    `<body>`, just `<title>`, `<style>`, the markup and the inline module script, in that order.
 *    A path argument writes a copy of it there too: `npm run build:demo -- <path>`.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Refuse to produce anything larger (the artifact host's limit is 16 MB). */
export const MAX_BYTES = 16 * 1024 * 1024;

const SCRIPT_TAG = /<script type="module" crossorigin src="\.\/([^"]+\.js)"><\/script>\s*/g;
const STYLESHEET_TAG = /<link rel="stylesheet" crossorigin href="\.\/([^"]+\.css)">\s*/g;

/**
 * JavaScript that is safe inside an inline `<script>`: no end tag, no comment opener. U+FFFD is
 * written as `�` (the minifier folds the core's escape back into the character, and the
 * artifact host refuses pages containing it, as the mark of a lost character); it only occurs in
 * string, template and regular-expression literals, where the escape means the same.
 */
export function scriptText(code: string): string {
  if (code.includes('<!--')) throw new Error('The script contains "<!--"; cannot inline it safely');
  return code.replace(/<\/(script)/gi, '<\\/$1').replaceAll('�', '\\uFFFD');
}

/** CSS that is safe inside an inline `<style>`. */
export function styleText(css: string): string {
  if (/<\/style/i.test(css)) throw new Error('The stylesheet contains "</style"');
  return css;
}

/**
 * Vite's HTML with its module script and stylesheet inlined: the styles where the stylesheet was
 * linked, the script at the end of the body (a module script runs after parsing either way).
 */
export function inlineDocument(html: string, read: (file: string) => string): string {
  const scripts: string[] = [];
  let out = html.replace(SCRIPT_TAG, (_tag, file: string) => {
    scripts.push(`<script type="module">\n${scriptText(read(file).trim())}\n</script>`);
    return '';
  });
  out = out.replace(
    STYLESHEET_TAG,
    (_tag, file: string) => `<style>\n${styleText(read(file).trim())}\n</style>\n`,
  );
  if (scripts.length === 0) throw new Error('No module script to inline in the page');
  if (!out.includes('</body>')) throw new Error('The page has no </body>');
  // A replacer function: the code must not be read as a replacement pattern ($&, $' …).
  return out.replace('</body>', () => `${scripts.join('\n')}\n</body>`);
}

/** The inside of the first `<tag>` element, or null. */
function element(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(html);
  return match ? (match[1] ?? '') : null;
}

/**
 * A complete inlined document as a fragment for a host that supplies the document skeleton:
 * `<title>`, then every `<style>`, then the body's markup, then its scripts.
 */
export function artifactFragment(document: string): string {
  const head = element(document, 'head');
  const body = element(document, 'body');
  const title = head === null ? null : element(head, 'title');
  if (head === null || body === null || title === null) {
    throw new Error('Expected a document with a <head>, a <title> and a <body>');
  }
  const styles = [...head.matchAll(/<style>[\s\S]*?<\/style>/g)].map((m) => m[0]);
  const scripts = [...body.matchAll(/<script type="module">[\s\S]*?<\/script>/g)].map((m) => m[0]);
  const markup = body.replace(/<script type="module">[\s\S]*?<\/script>/g, '').trim();
  return `${[`<title>${title.trim()}</title>`, ...styles, markup, ...scripts].join('\n')}\n`;
}

/**
 * What in `html` would make the browser load something: `src`/`href` attributes in the markup
 * and `url()` / `@import` in the styles that are not data: URIs. Script bodies are not searched.
 */
export function externalReferences(html: string): string[] {
  const found: string[] = [];
  const markup = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');
  for (const m of markup.matchAll(/\s(src|href)=["']?([^"'\s>]*)/g)) {
    if (!(m[2] ?? '').startsWith('data:')) found.push(`${m[1]}=${m[2]}`);
  }
  for (const css of markup.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    for (const m of (css[1] ?? '').matchAll(/url\(\s*['"]?([^'")\s]*)/g)) {
      if (!(m[1] ?? '').startsWith('data:')) found.push(`url(${m[1]})`);
    }
    if (/@import/.test(css[1] ?? '')) found.push('@import');
  }
  return found;
}

/**
 * Vite's demo build in `dir` (`demo.html` and its assets) as the two self-contained pages, each
 * checked to load nothing and to stay under {@link MAX_BYTES}.
 */
export async function inlineBuild(dir: string): Promise<{ document: string; fragment: string }> {
  const built = await readFile(join(dir, 'demo.html'), 'utf8');
  const assets = new Map<string, string>();
  for (const m of built.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)) {
    const file = m[1] ?? '';
    assets.set(file, await readFile(join(dir, file), 'utf8'));
  }
  const document = inlineDocument(built, (file) => {
    const text = assets.get(file);
    if (text === undefined) throw new Error(`${file} was not built`);
    return text;
  });
  const fragment = artifactFragment(document);
  for (const [name, html] of [
    ['the document', document],
    ['the fragment', fragment],
  ] as const) {
    const external = externalReferences(html);
    if (external.length > 0) throw new Error(`${name} still loads ${external.join(', ')}`);
    const bytes = Buffer.byteLength(html);
    if (bytes > MAX_BYTES) throw new Error(`${name} is ${bytes} bytes, over ${MAX_BYTES}`);
  }
  return { document, fragment };
}

async function main(): Promise<void> {
  const out = fileURLToPath(new URL('../dist-demo/', import.meta.url));
  const { document, fragment } = await inlineBuild(out);
  await writeFile(join(out, 'index.html'), document);
  await writeFile(join(out, 'artifact.html'), fragment);
  await rm(join(out, 'demo.html'));
  await rm(join(out, 'assets'), { recursive: true, force: true });
  const copy = process.argv[2];
  if (copy !== undefined && copy !== '') {
    const target = resolve(process.env['INIT_CWD'] ?? process.cwd(), copy);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, fragment);
    console.log(`Wrote ${target}`);
  }
  const kb = (html: string) => `${Math.round(Buffer.byteLength(html) / 1024)} kB`;
  console.log(`dist-demo/index.html ${kb(document)}, dist-demo/artifact.html ${kb(fragment)}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
