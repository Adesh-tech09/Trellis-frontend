import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || '3000';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`;

/**
 * Viewports every page is expected to hold its layout at.
 * Kept in sync with `tailwind.config.cjs` (sm 600 / md 900 / lg 1200) and with
 * `e2e/viewport.spec.ts`, which asserts the layout at each of these sizes.
 */
export const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

/** Layout assertions belong to the viewport projects only. */
const LAYOUT_SPEC = /viewport\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // ── Engine matrix: the functional flows on every engine we support. ──────
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: LAYOUT_SPEC,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: LAYOUT_SPEC,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: LAYOUT_SPEC,
    },
    {
      // Chromium engine with Android emulation: touch, mobile UA, mobile
      // viewport metrics.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], viewport: VIEWPORTS.mobile },
      testIgnore: LAYOUT_SPEC,
    },
    {
      // WebKit engine with iOS emulation.
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'], viewport: VIEWPORTS.mobile },
      testIgnore: LAYOUT_SPEC,
    },
    // ── Viewport matrix: the exact sizes from the issue, one engine, one
    //    project per size so a layout regression names the size that broke. ──
    {
      name: 'viewport-mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORTS.mobile,
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
      testMatch: LAYOUT_SPEC,
    },
    {
      name: 'viewport-tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORTS.tablet,
        deviceScaleFactor: 2,
        hasTouch: true,
      },
      testMatch: LAYOUT_SPEC,
    },
    {
      name: 'viewport-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORTS.desktop,
      },
      testMatch: LAYOUT_SPEC,
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run start',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
