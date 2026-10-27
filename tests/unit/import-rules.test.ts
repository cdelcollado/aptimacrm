import { describe, expect, it } from "vitest";
import { planRows } from "@/server/domain/imports/parse-job";
import { suggestMapping, validateMapping } from "@/server/domain/imports/mapping";
import { validateCompanyRecord, validateContactRecord } from "@/server/domain/imports/validate";

const users = new Map([["ana@aptima.test", "user-ana"]]);
const headers = ["Nombre", "Apellidos", "Correo", "Teléfono", "Empresa", "Responsable"];
const fields = suggestMapping("contacts", headers);

describe("suggestMapping", () => {
  it("recognises common Spanish and Catalan headers", () => {
    expect(fields).toMatchObject({ first_name: "Nombre", last_name: "Apellidos", email: "Correo", phone: "Teléfono", company_name: "Empresa", owner_email: "Responsable" });
  });
  it("requires the mandatory fields", () => {
    const errors = validateMapping("contacts", { ...fields, email: null }, headers);
    expect(errors).toHaveProperty("email", "required");
  });
  it("refuses one column mapped to two fields", () => {
    const errors = validateMapping("contacts", { ...fields, last_name: "Nombre" }, headers);
    expect(errors._general).toBe("one_column_per_field");
  });
});

describe("validateContactRecord", () => {
  it("requires a valid email and first name", () => {
    expect(validateContactRecord({ first_name: "", email: "x" }).errors.map((e) => e.code)).toEqual(["required", "invalid_email"]);
  });
  it("normalises the email and phone for matching", () => {
    const { value } = validateContactRecord({ first_name: "Pau", email: " PAU@Acme.es ", phone: "611 22 33 44" });
    expect(value).toMatchObject({ emailNormalized: "pau@acme.es", phone: "+34611223344" });
  });
});

describe("validateCompanyRecord", () => {
  it("accepts a website and derives its domain", () => {
    expect(validateCompanyRecord({ name: "Acme", website: "https://www.acme.es" }).value?.domainNormalized).toBe("acme.es");
  });
  it("flags an invalid website", () => {
    expect(validateCompanyRecord({ name: "Acme", website: "not a site" }).errors[0]?.code).toBe("invalid_domain");
  });
});

describe("planRows duplicate rules", () => {
  const base = { kind: "contacts" as const, headers, fields, defaultOwnerId: "user-default", activeUserIdByEmail: users };

  it("never silently creates a second contact with an existing normalized email", () => {
    const planned = planRows({
      ...base,
      rows: [["Pau", "Vidal", "PAU@acme.es", "", "", ""]],
      existingContactIdByEmail: new Map([["pau@acme.es", "contact-1"]]),
    });
    expect(planned[0]).toMatchObject({ status: "duplicate", matchContactId: "contact-1" });
  });

  it("flags the second occurrence of the same email within one file", () => {
    const planned = planRows({
      ...base,
      rows: [
        ["Pau", "Vidal", "pau@acme.es", "", "", ""],
        ["Pau", "Vidal", "Pau@Acme.es", "", "", ""],
      ],
    });
    expect(planned[0]!.status).toBe("valid");
    expect(planned[1]).toMatchObject({ status: "duplicate", normalized: expect.objectContaining({ duplicateOfRow: 2 }) });
  });

  it("maps owner_email to an active user and falls back to the default owner", () => {
    const planned = planRows({
      ...base,
      rows: [
        ["Pau", "Vidal", "pau@acme.es", "", "", "ana@aptima.test"],
        ["Marta", "Torres", "marta@vidrestorres.cat", "", "", ""],
      ],
    });
    expect(planned[0]!.normalized).toMatchObject({ ownerId: "user-ana" });
    expect(planned[1]!.normalized).toMatchObject({ ownerId: "user-default" });
  });

  it("reports an unknown owner email as a row error, not a silent default", () => {
    const planned = planRows({ ...base, rows: [["Pau", "Vidal", "pau@acme.es", "", "", "nobody@x.es"]] });
    expect(planned[0]!.status).toBe("error");
    expect(planned[0]!.errors.map((e) => e.code)).toContain("unknown_owner");
  });

  it("reports row numbers as they appear in the spreadsheet (header is row 1)", () => {
    const planned = planRows({ ...base, rows: [["", "", "", "", "", ""], ["Pau", "V", "pau@acme.es", "", "", ""]] });
    expect(planned.map((p) => p.rowNumber)).toEqual([2, 3]);
    expect(planned[0]!.status).toBe("error");
  });

  it("matches companies by domain before name", () => {
    const planned = planRows({
      kind: "companies",
      headers: ["name", "website"],
      fields: { name: "name", website: "website", owner_email: null },
      defaultOwnerId: "user-default",
      activeUserIdByEmail: users,
      rows: [["Acme Ibèrica", "acme.es"]],
      existingCompanyIdByDomain: new Map([["acme.es", "company-1"]]),
    });
    expect(planned[0]).toMatchObject({ status: "duplicate", matchCompanyId: "company-1" });
  });
});
