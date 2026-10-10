import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('handles the native settings bridge, token rotation and cancellation', async () => {
  const path = fileURLToPath(new URL('./android-settings.node.ts', import.meta.url));
  const result = await promisify(execFile)(process.execPath, [path]);
  expect(result.stdout).toContain('tests 3');
  expect(result.stdout).toContain('fail 0');
});
