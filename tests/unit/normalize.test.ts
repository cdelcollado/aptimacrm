import { describe, expect, it } from "vitest";
import { companyDomainFromEmail, normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePhone } from "@/server/normalize";

describe("normalizeEmail", () => {
  it("lowercases, trims and accepts plain addresses", () => {
    expect(normalizeEmail("  Pau.Vidal@ACME.es ")).toBe("pau.vidal@acme.es");
  });
  it("rejects malformed addresses", () => {
    expect(normalizeEmail("no-at-sign")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a b@acme.es")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
  it("rejects addresses longer than 254 characters", () => {
    expect(normalizeEmail(`${"a".repeat(250)}@x.es`)).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("strips protocol, path, port, trailing dot and leading www", () => {
    expect(normalizeDomain("https://www.Acme.es/contacte?x=1")).toBe("acme.es");
    expect(normalizeDomain("acme.es:8080.")).toBe("acme.es");
  });
  it("takes the domain from an email address", () => {
    expect(normalizeDomain("pau@acme.es")).toBe("acme.es");
  });
  it("keeps subdomains other than www", () => {
    expect(normalizeDomain("mail.acme.es")).toBe("mail.acme.es");
  });
  it("rejects values that are not hostnames", () => {
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("companyDomainFromEmail", () => {
  it("never suggests a company from a free mail provider", () => {
    expect(companyDomainFromEmail("someone@gmail.com")).toBeNull();
    expect(companyDomainFromEmail("someone@hotmail.es")).toBeNull();
  });
  it("suggests the employer domain for work addresses", () => {
    expect(companyDomainFromEmail("pau@acme.es")).toBe("acme.es");
  });
});

describe("normalizePhone", () => {
  it("normalises Spanish mobile numbers to +34", () => {
    expect(normalizePhone("611 22 33 44")).toBe("+34611223344");
  });
  it("converts 00 prefix to +", () => {
    expect(normalizePhone("0033 6 12 34 56 78")).toBe("+33612345678");
  });
  it("returns null for empty or invalid input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("normalizeCompanyName", () => {
  it("makes accent, case, punctuation and legal suffix differences disappear", () => {
    expect(normalizeCompanyName("Cafés Riera, S.L.")).toBe(normalizeCompanyName("CAFES RIERA SL"));
    expect(normalizeCompanyName("Acme Ibèrica S.A.U.")).toBe("acme iberica");
  });
  it("keeps different names different", () => {
    expect(normalizeCompanyName("Acme")).not.toBe(normalizeCompanyName("Acme Ibérica"));
  });
});
