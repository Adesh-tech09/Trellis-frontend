import { test, expect } from '@playwright/test';
import { activate } from './utils/layout';

const VALID_WALLET_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const WALLET_TYPE_KEY = 'stellar_wallet_type';
const WALLET_ADDRESS_KEY = 'stellar_wallet_address';

test.describe('main user journey', () => {
  test('connect wallet state → browse marketplace → open an agent', async ({
    page,
  }) => {
    await page.addInitScript(
      ([address, typeKey, addressKey, walletType]) => {
        window.localStorage.setItem(addressKey, address as string);
        window.localStorage.setItem(typeKey, walletType as string);
        window.localStorage.setItem(
          'stellar_network',
          'TESTNET',
        );
      },
      [
        VALID_WALLET_ADDRESS,
        WALLET_TYPE_KEY,
        WALLET_ADDRESS_KEY,
        'freighter',
      ] as const,
    );

    await page.goto('/', { waitUntil: 'load' });
    await expect(
      page.getByRole('link', { name: /explore marketplace/i }),
    ).toBeVisible();

    // Touch projects tap, pointer projects click - see e2e/utils/layout.ts.
    await activate(page.getByRole('link', { name: /explore marketplace/i }));
    await expect(page).toHaveURL(/\/marketplace/);
    await expect(
      page.getByRole('heading', { name: /agent marketplace/i }),
    ).toBeVisible();

    await expect(page.getByText('DataBot Pro').first()).toBeVisible();

    // The card action has to be reachable with the input model of the current
    // project: a hover-only affordance would never fire on a touch device.
    const viewAgent = page.getByRole('button', { name: /view agent/i }).first();
    await viewAgent.scrollIntoViewIfNeeded();
    await expect(viewAgent).toBeVisible();
    await activate(viewAgent);

    await expect(page.getByText('DataBot Pro').first()).toBeVisible();
  });
});
