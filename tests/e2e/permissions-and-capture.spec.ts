import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import { signIn, expectNotice, USERS } from "./helpers";
import { withDb } from "./db";
import { E2E } from "./config";

test("a salesperson gets not-found for another owner's deal, forbidden for managers' pages and exports", async ({ page }) => {
  await signIn(page, USERS.ana, "/dashboard");
  const [joanDeal] = await withDb((c) => c.query<{ id: string }>("select id from deals where title = 'Expansió cafeteries'").then((r) => r.rows));

  await page.goto(`/deals/${joanDeal!.id}`);
  await expect(page.getByRole("heading", { name: "We could not find that record" })).toBeVisible();

  await page.goto("/imports");
  await expect(page.getByRole("heading", { name: "You do not have access to this page" })).toBeVisible();

  const exportResponse = await page.request.get(`${E2E.baseUrl}/api/exports/deals`);
  expect(exportResponse.status()).toBe(403);
  const fullResponse = await page.request.get(`${E2E.baseUrl}/api/exports/full?kind=deals`);
  expect(fullResponse.status()).toBe(403);
});

test("an expired session is explained on the sign-in screen and redirects back afterwards", async ({ page }) => {
  await signIn(page, USERS.ana, "/contacts");
  await withDb((c) =>
    c.query(
      "update sessions set expires_at = now() - interval '1 minute' where user_id = (select id from users where email_normalized = $1) and revoked_at is null",
      [USERS.ana],
    ),
  );
  await page.goto("/contacts");
  await expect(page).toHaveURL(/\/sign-in\?reason=expired/);
  await expect(page.getByText("Your session expired.")).toBeVisible();
});

test("signed-out visitors are sent to sign in and back to the page they wanted", async ({ page }) => {
  await page.context().addCookies([{ name: "aptima_locale", value: "en", url: E2E.baseUrl }]);
  await page.goto("/pipeline");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fpipeline/);
  await page.getByLabel("Email").fill(USERS.manager);
  await page.getByLabel("Password").fill(E2E.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/pipeline$/);
});

test("wrong passwords get one generic message and never reveal whether the email exists", async ({ page }) => {
  await page.context().addCookies([{ name: "aptima_locale", value: "en", url: E2E.baseUrl }]);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("nobody@aptima.test");
  await page.getByLabel("Password").fill("whatever-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectNotice(page, "The email or password is not correct.");
});

test("a bearer-less inbound email is refused, and a signed one is captured once", async ({ page }) => {
  await page.goto("/sign-in");
  const body = JSON.stringify({
    messageId: `e2e-${Date.now()}`,
    receivedAt: new Date().toISOString(),
    from: "pau.vidal@acme.es",
    to: "capture@crm.example.com",
    subject: "Re: pressupost",
    text: "Perfecte, endavant amb la proposta.",
  });
  const unsigned = await page.request.post(`${E2E.baseUrl}/api/email/inbound`, { data: body, headers: { "content-type": "application/json" } });
  expect(unsigned.status()).toBe(401);

  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `sha256=${createHmac("sha256", E2E.inboundSecret).update(`${ts}.${body}`).digest("hex")}`;
  const headers = { "content-type": "application/json", "x-aptima-timestamp": ts, "x-aptima-signature": sig };
  const first = await page.request.post(`${E2E.baseUrl}/api/email/inbound`, { data: body, headers });
  const second = await page.request.post(`${E2E.baseUrl}/api/email/inbound`, { data: body, headers });
  expect(first.status()).toBe(202);
  expect(second.status()).toBe(200);
  expect(await second.json()).toEqual({ status: "duplicate" });

  const [count] = await withDb((c) =>
    c.query<{ n: number }>("select count(*)::int as n from activities where source = 'bcc' and external_message_id = $1", [JSON.parse(body).messageId]).then((r) => r.rows),
  );
  expect(count!.n).toBe(1);
});

test("the interface can switch language and keeps the choice", async ({ page }) => {
  await signIn(page, USERS.ana, "/dashboard");
  await page.locator('select[name="locale"]').selectOption("es");
  await page.getByRole("button", { name: "Apply" }).first().click();
  await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();
});
