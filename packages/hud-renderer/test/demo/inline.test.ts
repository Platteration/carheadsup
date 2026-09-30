import { describe, expect, it } from 'vitest';
import {
  artifactFragment,
  externalReferences,
  inlineDocument,
  scriptText,
} from '../../scripts/inline-demo.ts';

/** The shape of Vite's demo.html output. */
const BUILT = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>carheadsup Drive Simulator</title>
    <link rel="icon" href="data:," />
    <script type="module" crossorigin src="./assets/demo-abc.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/style-def.css">
  </head>
  <body>
    <div id="app"></div>
    <noscript>The drive simulator needs JavaScript.</noscript>
  </body>
</html>
`;

const ASSETS: Record<string, string> = {
  'assets/demo-abc.js': 'const a = "$&$\'$`"; const b = "</script>"; render(a, b);\n',
  'assets/style-def.css': '@font-face{src:url(data:font/woff2;base64,AAAA)}body{margin:0}\n',
};
const read = (file: string): string => {
  const text = ASSETS[file];
  if (text === undefined) throw new Error(`no ${file}`);
  return text;
};

describe('the demo inliner', () => {
  it('inlines the stylesheet in the head and the script at the end of the body', () => {
    const html = inlineDocument(BUILT, read);
    expect(html).not.toContain('./assets/');
    expect(html).toMatch(/<head>[\s\S]*<style>\n@font-face[\s\S]*<\/style>[\s\S]*<\/head>/);
    expect(html).toMatch(/<noscript>[\s\S]*<\/noscript>\s*<script type="module">[\s\S]*<\/body>/);
    // Code is copied verbatim ($-patterns are not replacement patterns), end tags escaped.
    expect(html).toContain('const a = "$&$\'$`";');
    expect(html).toContain('const b = "<\\/script>";');
    expect(externalReferences(html)).toEqual([]);
  });

  it('refuses code that cannot be inlined safely', () => {
    expect(() => scriptText('const s = "<!--";')).toThrow(/<!--/);
    expect(() =>
      inlineDocument(BUILT, (file) => (file.endsWith('.css') ? 'a{}</style>' : 'x')),
    ).toThrow(/<\/style/);
  });

  it('makes a fragment for a host skeleton: title, styles, markup, script', () => {
    const fragment = artifactFragment(inlineDocument(BUILT, read));
    expect(fragment.startsWith('<title>carheadsup Drive Simulator</title>\n<style>')).toBe(true);
    for (const tag of ['<!doctype', '<html', '<head', '<body', '<meta', '<link']) {
      expect(fragment.toLowerCase()).not.toContain(tag);
    }
    const order = ['<title>', '<style>', '<div id="app">', '<noscript>', '<script type="module">'];
    const positions = order.map((tag) => fragment.indexOf(tag));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(fragment.trimEnd().endsWith('</script>')).toBe(true);
  });

  it('finds anything that would still be loaded from elsewhere', () => {
    expect(
      externalReferences(
        '<link href="https://fonts.example/x.css"><img src="a.png"><img src="data:image/png;base64,">' +
          '<style>@import "x.css"; b{background:url(/b.png)} i{background:url(data:x)}</style>' +
          '<script type="module">fetch("https://ignored.example")</script>',
      ),
    ).toEqual(['href=https://fonts.example/x.css', 'src=a.png', 'url(/b.png)', '@import']);
  });
});
