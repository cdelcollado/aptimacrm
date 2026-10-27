import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";
import { E2E } from "./config";

/** Journey 3: manager reviews overdue tasks and pipeline, filters by owner and stage, and exports a snapshot. */
test("manager reviews overdue tasks, filters the pipeline, and exports an authorized snapshot", async ({ page }) => {
  await signIn(page, USERS.manager, "/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "1", exact: true }).first().click();
  await expect(page).toHaveURL(/\/tasks\?filter=overdue/);
  await expect(page.getByText("Send the proposal revision").or(page.getByText("Enviar proposta revisada"))).toBeVisible();

  await page.goto("/pipeline");
  await page.getByLabel("Owner").selectOption({ label: "Ana Ruiz" });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: "Renovació flota 2026" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Expansió cafeteries" })).toHaveCount(0);

  const href = await page.getByRole("link", { name: "Export pipeline CSV" }).getAttribute("href");
  expect(href).toContain("owner=");
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body.split("\n")[0]).toContain("deal_id");
  expect(body).toContain("Renovació flota 2026");
  expect(body).not.toContain("Expansió cafeteries");
  expect(body).not.toContain("pau.vidal@acme.es");
});

test("managers cannot run a full CRM export; only admins can", async ({ page }) => {
  await signIn(page, USERS.manager, "/dashboard");
  const denied = await page.request.get(`${E2E.baseUrl}/api/exports/full?kind=contacts`);
  expect(denied.status()).toBe(403);

  await page.context().clearCookies();
  await signIn(page, USERS.admin, "/admin");
  const allowed = await page.request.get(`${E2E.baseUrl}/api/exports/full?kind=contacts`);
  expect(allowed.status()).toBe(200);
  expect((await allowed.text()).split("\n")[0]).toContain("first_name");
});
