import { test, expect } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
const roles = [
  { name: 'admin', email: 'demo-admin@example.test', path: '/admin-command-center', label: 'Administrator' },
  { name: 'doctor', email: 'demo-doctor@example.test', path: '/doctor-dashboard', label: 'Doctor' },
  { name: 'staff', email: 'demo-nurse@example.test', path: '/medical-staff', label: 'Medical Staff' },
  { name: 'receptionist', email: 'demo-receptionist@example.test', path: '/receptionist-dashboard', label: 'Receptionist' },
  { name: 'patient', email: 'demo-patient@example.test', path: '/patient-portal', label: 'Patient', patientOnly: true },
];

test.beforeEach(async (...args) => {
  const testInfo = args[1];
  test.skip(!password, 'Set E2E_PASSWORD to the local DEMO_SEED_PASSWORD for the role smoke suite.');
  testInfo.annotations.push({ type: 'security', description: 'Credentials are supplied only through the process environment.' });
});

for (const role of roles) {
  test(`${role.label} dashboard is reachable at desktop and phone widths`, async ({ page }) => {
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
    page.on('response', (response) => { if (response.status() >= 500) failedRequests.push(`${response.status()} ${response.url()}`); });

    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(role.patientOnly ? '/patient-login' : '/login');
      await page.getByLabel('Email').fill(role.email);
      if (!role.patientOnly) await page.getByLabel('Sign in as').selectOption(role.name);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL(new RegExp(`${role.path.replace('/', '\\/')}$`));
      await expect(page.locator('body')).not.toContainText('Sign-in service unavailable');
      await page.screenshot({ path: `test-results/${role.name}-${viewport.width}x${viewport.height}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow, `${role.name} has horizontal page overflow at ${viewport.width}px`).toBe(false);
      await page.getByRole('button', { name: /sign out/i }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    expect(failedRequests, failedRequests.join('\n')).toEqual([]);
  });
}
