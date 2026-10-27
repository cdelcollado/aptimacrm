import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { contacts, companies, importRows, imports, jobs } from "@/server/db/schema";
import { createImportFromUpload, setImportMapping, confirmImport, cancelImport } from "@/server/domain/imports/service";
import { drainJobs } from "@/server/jobs/worker";
import { makeCompany, makeContact, makeUser } from "../helpers/db";
import { asPrincipal } from "../helpers/principal";
import { ValidationError } from "@/server/errors";
import { getStorage } from "@/server/adapters/storage";
import { importObjectKey } from "@/server/domain/imports/keys";
import { suggestMapping } from "@/server/domain/imports/mapping";

const CSV = [
  "Nombre,Apellidos,Correo,Teléfono,Empresa,Responsable",
  "Pau,Vidal,pau.vidal@acme.es,611 22 33 44,Acme,ana@aptima.test",
  "Marta,Torres,marta@vidrestorres.cat,,,",
  "Núria,Font,NURIA@acme.es,,,",
  "Jordi,Riera,no-es-correo,,,",
  "Nuria,Font,nuria@acme.es,,,",
].join("\n");

async function uploadAndMap(principal: ReturnType<typeof asPrincipal>, csv = CSV) {
  const { id } = await createImportFromUpload({ principal, kind: "contacts", fileName: "contactes.csv", bytes: Buffer.from(csv, "utf8") });
  await setImportMapping({
    principal,
    importId: id,
    fields: suggestMapping("contacts", csv.split("\n")[0]!.split(",")),
    defaultOwnerId: null,
  });
  await drainJobs(10);
  return id;
}

describe("contact CSV import", () => {
  it("stages the file privately, runs the parse as a job, and flags duplicates instead of creating them", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    const ana = await makeUser("salesperson", "Ana Ruiz", "ana@aptima.test");
    const existing = await makeContact(ana.id, "Pau", "pau.vidal@acme.es");
    const principal = asPrincipal(manager);

    const id = await uploadAndMap(principal);

    const [imp] = await getDb().select().from(imports).where(eq(imports.id, id));
    expect(imp).toMatchObject({ status: "ready", totalRows: 5, errorRows: 1, duplicateRows: 2, validRows: 2 });
    expect(imp!.fileKey).toBe(importObjectKey(id));

    const rows = await getDb().select().from(importRows).where(eq(importRows.importId, id));
    const pau = rows.find((r) => (r.normalized as { emailNormalized?: string }).emailNormalized === "pau.vidal@acme.es");
    expect(pau).toMatchObject({ status: "duplicate", matchContactId: existing.id });

    // Only the pre-existing contact exists: nothing was created silently.
    const all = await getDb().select().from(contacts);
    expect(all).toHaveLength(1);
  });

  it("refuses to confirm while a duplicate has no decision", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    const principal = asPrincipal(manager);
    const id = await uploadAndMap(principal);
    await expect(confirmImport({ principal, importId: id, decisions: {} })).rejects.toBeInstanceOf(ValidationError);
    expect(await getDb().select().from(contacts)).toHaveLength(0);
  });

  it("creates the valid rows, applies explicit decisions, and is idempotent on resubmit", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    const ana = await makeUser("salesperson", "Ana Ruiz", "ana@aptima.test");
    const existing = await makeContact(ana.id, "Pau", "pau.vidal@acme.es");
    const principal = asPrincipal(manager);
    const id = await uploadAndMap(principal);

    const rows = await getDb().select().from(importRows).where(eq(importRows.importId, id));
    const decisions: Record<string, "create" | "link" | "skip"> = {};
    for (const r of rows.filter((x) => x.status === "duplicate")) {
      const isExisting = r.matchContactId === existing.id;
      decisions[r.id] = isExisting ? "link" : "skip";
    }

    // Valid: Marta and the first Núria. Duplicates: Pau (existing, linked) and the second Núria (same file, skipped).
    const first = await confirmImport({ principal, importId: id, decisions });
    expect(first).toMatchObject({ created: 2, linked: 1, skipped: 1, alreadyCompleted: false });
    const created = await getDb().select().from(contacts);
    expect(created.map((c) => c.emailNormalized).sort()).toEqual(["marta@vidrestorres.cat", "nuria@acme.es", "pau.vidal@acme.es"]);

    const again = await confirmImport({ principal, importId: id, decisions });
    expect(again.alreadyCompleted).toBe(true);
    // Existing Pau + Marta + Núria. The resubmit created nothing.
    expect(await getDb().select().from(contacts)).toHaveLength(3);
  });

  it("creates a second record only when a reviewer explicitly chooses create", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    const ana = await makeUser("salesperson", "Ana Ruiz", "ana@aptima.test");
    const existing = await makeContact(ana.id, "Pau", "pau.vidal@acme.es");
    const principal = asPrincipal(manager);
    const id = await uploadAndMap(principal);
    const rows = await getDb().select().from(importRows).where(eq(importRows.importId, id));
    const decisions: Record<string, "create" | "link" | "skip"> = {};
    for (const r of rows.filter((x) => x.status === "duplicate")) decisions[r.id] = r.matchContactId === existing.id ? "create" : "skip";
    await confirmImport({ principal, importId: id, decisions });
    const withPau = (await getDb().select().from(contacts)).filter((c) => c.emailNormalized === "pau.vidal@acme.es");
    expect(withPau).toHaveLength(2);
  });

  it("refuses to link a row that has no matching record", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    const principal = asPrincipal(manager);
    const id = await uploadAndMap(principal);
    const rows = await getDb().select().from(importRows).where(eq(importRows.importId, id));
    const inFileDuplicate = rows.find((r) => r.status === "duplicate" && !r.matchContactId)!;
    await expect(confirmImport({ principal, importId: id, decisions: { [inFileDuplicate.id]: "link" } })).rejects.toMatchObject({ code: "validation" });
  });

  it("marks the file for deletion after confirm, and the cleanup job removes it", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    const principal = asPrincipal(manager);
    const id = await uploadAndMap(principal, "name,email\nPau,pau@acme.es\n");
    await confirmImport({ principal, importId: id, decisions: {} });
    expect(await getStorage().get(importObjectKey(id))).toMatchObject({ ok: true });

    await drainJobs(10);
    expect(await getStorage().get(importObjectKey(id))).toMatchObject({ ok: false, error: { code: "not_found" } });
    const [imp] = await getDb().select().from(imports).where(eq(imports.id, id));
    expect(imp!.fileKey).toBeNull();
  });

  it("cancels an import and schedules cleanup", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    const principal = asPrincipal(manager);
    const { id } = await createImportFromUpload({ principal, kind: "contacts", fileName: "a.csv", bytes: Buffer.from(CSV) });
    await cancelImport(principal, id);
    const [imp] = await getDb().select().from(imports).where(eq(imports.id, id));
    expect(imp!.status).toBe("cancelled");
    const cleanup = await getDb().select().from(jobs).where(eq(jobs.kind, "import.cleanup_file"));
    expect(cleanup).toHaveLength(1);
  });

  it("does not let a salesperson import anything", async () => {
    const ana = await makeUser("salesperson", "Ana Ruiz");
    await expect(createImportFromUpload({ principal: asPrincipal(ana), kind: "contacts", fileName: "a.csv", bytes: Buffer.from(CSV) })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a file with no usable header before storing anything", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    await expect(createImportFromUpload({ principal: asPrincipal(manager), kind: "contacts", fileName: "a.csv", bytes: Buffer.from("\n\n") })).rejects.toBeInstanceOf(ValidationError);
    expect(await getDb().select().from(imports)).toHaveLength(0);
  });

  it("imports companies and detects an existing domain", async () => {
    const manager = await makeUser("manager", "Marc Soler");
    const ana = await makeUser("salesperson", "Ana Ruiz", "ana@aptima.test");
    await makeCompany(ana.id, "Acme Ibèrica", "acme.es");
    const principal = asPrincipal(manager);
    const csv = "name,website\nAcme SL,https://www.acme.es\nNordic,nordic.example\n";
    const { id } = await createImportFromUpload({ principal, kind: "companies", fileName: "e.csv", bytes: Buffer.from(csv) });
    await setImportMapping({ principal, importId: id, fields: { name: "name", website: "website", owner_email: null }, defaultOwnerId: ana.id });
    await drainJobs(10);
    const [imp] = await getDb().select().from(imports).where(eq(imports.id, id));
    expect(imp).toMatchObject({ status: "ready", duplicateRows: 1, validRows: 1 });
    await confirmImport({ principal, importId: id, decisions: Object.fromEntries((await getDb().select().from(importRows).where(eq(importRows.importId, id))).filter((r) => r.status === "duplicate").map((r) => [r.id, "skip"])) });
    expect(await getDb().select().from(companies)).toHaveLength(2);
  });
});
