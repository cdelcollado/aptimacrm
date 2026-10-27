import { test, expect } from "@playwright/test";
import { signIn, expectNotice, USERS } from "./helpers";

/**
 * Journey 2: a salesperson creates a deal from a company, assigns owner and stage, logs a call,
 * adds a follow-up task, and moves the deal through the pipeline (keyboard and drag).
 */
test("salesperson creates a deal, logs a call, adds a task, and moves it through the pipeline", async ({ page }, testInfo) => {
  // Unique per project so the two viewport runs never see each other's deals.
  const title = `Ampliació de llicències ${testInfo.project.name}`;
  await signIn(page, USERS.ana, "/companies");

  await page.getByRole("link", { name: /Acme Ibèrica/ }).first().click();
  await page.getByRole("link", { name: "New deal" }).click();
  await expect(page.getByRole("heading", { name: "New deal" })).toBeVisible();

  await page.getByLabel("Deal title").fill(title);
  await page.getByLabel("Value (EUR)").fill("1.500,00");
  await page.getByLabel("Stage").selectOption({ label: "Proposta" });
  await page.getByLabel("Primary contact").selectOption({ label: "Pau Vidal" });
  await page.getByRole("button", { name: "Create deal" }).click();

  await page.waitForURL(/\/deals\/[0-9a-f-]{36}/);
  await expectNotice(page, "Deal created.");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("€1,500.00").first()).toBeVisible();

  // Log a call. Stays on the deal, the timeline shows it.
  await page.getByLabel("Type").selectOption("call");
  await page.getByLabel("What happened").fill("Pau wants a demo before signing.");
  await page.getByRole("button", { name: "Log activity" }).click();
  await expectNotice(page, "Activity logged.");
  await expect(page.locator("ul.timeline div.body", { hasText: "Pau wants a demo before signing." })).toBeVisible();

  // Follow-up task due tomorrow.
  await page.locator("summary", { hasText: "Add task" }).click();
  await page.getByLabel("Task *", { exact: true }).fill("Send the demo booking");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Due date").fill(tomorrow);
  await page.getByRole("button", { name: "Add task" }).last().click();
  await expectNotice(page, "Task added.");
  await expect(page.getByText("Send the demo booking")).toBeVisible();

  // Move by keyboard-friendly form: the stage menu on the deal.
  await page.getByRole("combobox", { name: "Move to stage" }).selectOption({ label: "Negociació" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expectNotice(page, "Deal moved to Negociació.");
  await expect(page.getByText("Stage change").first()).toBeVisible();

  // Board: the card is in its new column.
  await page.goto("/pipeline");
  const negotiation = page.getByRole("region", { name: /^Negociació/ });
  await expect(negotiation.getByRole("link", { name: title })).toBeVisible();

  // Drag-and-drop (desktop pointer only; touch drag is covered by the phone project's keyboard path).
  if (testInfo.project.name === "desktop") {
    const card = page.locator("article.deal-card", { hasText: title });
    await card.dragTo(page.getByRole("region", { name: /^Qualificació/ }));
    await expectNotice(page, "Deal moved to Qualificació.");
    await expect(page.getByRole("region", { name: /^Qualificació/ }).getByRole("link", { name: title })).toBeVisible();
  }
});
