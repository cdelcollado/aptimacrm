import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { signIn, expectNotice, USERS } from "./helpers";

/** Journey 1: admin/manager imports contacts, reviews errors and duplicates, confirms, then merges a duplicate. */
test("manager imports a CSV, reviews errors and duplicates, confirms, and merges an intentional duplicate", async ({ page }) => {
  await signIn(page, USERS.manager, "/imports");

  await page.getByRole("radio", { name: "Contacts" }).check();
  await page.getByLabel("CSV file").setInputFiles(fileURLToPath(new URL("./fixtures/contacts-import.csv", import.meta.url)));
  await page.getByRole("button", { name: "Upload CSV" }).click();

  await page.waitForURL(/\/imports\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Map columns" })).toBeVisible();
  await expect(page.getByLabel("First name *")).toHaveValue("Nombre");
  await page.getByRole("button", { name: "Check file" }).click();

  // The worker parses the file; the page refreshes itself until the review is ready.
  await expect(page.getByText(/5 rows: 2 ready, 1 with errors, 2 possible duplicates\./)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Rows with errors" })).toBeVisible();
  await expect(page.getByText("Not a valid email address.")).toBeVisible();

  // Duplicates have no default decision: confirming without choices is refused.
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expectNotice(page, "Choose an action for every possible duplicate");

  await page.getByRole("group", { name: /Pau/ }).getByLabel("Use the existing record").check();
  await page.getByRole("group", { name: /Nuria/ }).getByLabel("Skip this row").check();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expectNotice(page, "Created 2, linked 1, skipped 1.");

  // Intentional duplicate: two Núria Font contacts share an email. Merge one into the other.
  await page.goto("/contacts?q=Font");
  const nuria = page.getByRole("link", { name: /Núria Font/ }).first();
  await expect(page.getByText("Possible duplicate").first()).toBeVisible();
  await nuria.click();
  await page.getByRole("region", { name: "Merge with another contact" }).getByRole("link", { name: "Núria Font Puig" }).click();

  await expect(page.getByRole("heading", { name: "Merge preview" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm merge" }).click();
  await expectNotice(page, "Merged. The activity timeline now shows the merge.");
  await expect(page.getByText("Merged Núria Font Puig")).toBeVisible();
});
