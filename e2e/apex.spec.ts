import { expect, test } from '@playwright/test';

for (const size of [{ width: 1280, height: 480 }, { width: 800, height: 480 }]) {
  test.describe(`Apex ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });
    test('keeps speed, navigation and limit in separate bounds', async ({ page }) => {
      await page.goto('/?layout=apex&fixture=imperial-us&preview=1');
      await expect(page.locator('[data-apex-layout]')).toBeVisible();
      const boxes = await Promise.all(['nav', 'speed', 'limit'].map((slot) =>
        page.locator(`[data-apex-slot="${slot}"]`).boundingBox(),
      ));
      const [nav, speed, limit] = boxes;
      expect(nav).not.toBeNull(); expect(speed).not.toBeNull(); expect(limit).not.toBeNull();
      expect(nav!.x + nav!.width).toBeLessThan(speed!.x);
      expect(speed!.x + speed!.width).toBeLessThan(limit!.x);
      await expect(page.locator('[data-glow]')).toHaveCount(0);
    });
    test('uses a front edge glow and no duplicate collision card', async ({ page }) => {
      await page.goto('/?layout=apex&fixture=collision-warning&preview=1');
      const glow = page.locator('[data-glow="front"]');
      await expect(glow).toBeVisible();
      await expect(glow).toHaveAttribute('data-severity', 'warning');
      await expect(page.locator('.hud-collision__chevrons, .hud-collision-border')).toHaveCount(0);
      const box = await glow.boundingBox();
      expect(box!.y + box!.height).toBeLessThan(size.height * 0.1);
      await expect(page.locator('[data-glow="rear"]')).toHaveCount(0);
    });
    test('shows left blind spot only on the left and honors reduced motion', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/?layout=apex&fixture=blind-spot-left&preview=1');
      await expect(page.locator('[data-glow="left"]')).toBeVisible();
      await expect(page.locator('[data-glow="right"]')).toHaveCount(0);
      const box = await page.locator('[data-glow="left"]').boundingBox();
      expect(box!.x + box!.width).toBeLessThan(size.width * 0.1);
      await page.goto('/?layout=apex&fixture=collision-warning&preview=1');
      await expect(page.locator('[data-glow="front"]')).toHaveCSS('animation-name', 'none');
    });
    test('leaves the previous layout available', async ({ page }) => {
      await page.goto('/?fixture=collision-warning&preview=1');
      await expect(page.locator('.hud-collision-border')).toBeVisible();
      await expect(page.locator('[data-apex-layout]')).toHaveCount(0);
    });
  });
}
