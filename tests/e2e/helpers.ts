import { expect, type BrowserContext, type Page } from "@playwright/test";
import { USERS, E2E } from "./config";

/** Sign in through the real form. English UI for stable assertions. */
export async function signIn(page: Page, email: string, next = "/dashboard") {
  await page.context().addCookies([{ name: "aptima_locale", value: "en", url: E2E.baseUrl }]);
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === next.split("?")[0], { timeout: 20_000 });
}

export async function expectNotice(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
}

export { USERS };
export type { BrowserContext };
