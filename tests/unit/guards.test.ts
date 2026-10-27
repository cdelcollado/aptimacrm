import { describe, expect, it } from "vitest";
import { cleanMultiline, cleanText, isUuid, parseEuroToCents, parseIsoDate, safeNextPath } from "@/server/security/guards";
import { csvSafeCell, parseCsv, CsvError, decodeUtf8 } from "@/server/domain/imports/csv";

describe("safeNextPath", () => {
  it("allows same-origin relative paths", () => {
    expect(safeNextPath("/pipeline?owner=1")).toBe("/pipeline?owner=1");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "pipeline", "", "/a\nb"])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });
  it("rejects very long values", () => {
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBe("/dashboard");
  });
});

describe("cleanText and cleanMultiline", () => {
  it("strips control characters and trims", () => {
    expect(cleanText("  Acme\u0000 Ibèrica  ", 50)).toBe("Acme Ibèrica");
  });
  it("respects the length limit", () => {
    expect(cleanText("abcdef", 3)).toBe("abc");
  });
  it("keeps line breaks in multiline text", () => {
    expect(cleanMultiline("linia 1\r\nlinia 2", 100)).toBe("linia 1\nlinia 2");
  });
});

describe("parseEuroToCents", () => {
  it.each([
    ["12500", 1250000],
    ["12.500,00", 1250000],
    ["12,5", 1250],
    ["1250.50", 125050],
    ["1,250.5", 125050],
    ["0", 0],
    ["", 0],
  ])("parses %s as %i cents", (input, cents) => {
    expect(parseEuroToCents(input)).toBe(cents);
  });
  it.each(["-5", "12,345", "abc", "1e5", "99999999999"])("rejects %s", (input) => {
    expect(parseEuroToCents(input)).toBeNull();
  });
});

describe("parseIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(parseIsoDate("2026-02-28")).toBe("2026-02-28");
  });
  it("rejects impossible dates such as 31 February", () => {
    expect(parseIsoDate("2026-02-31")).toBeNull();
  });
  it("rejects other formats", () => {
    expect(parseIsoDate("25/10/2026")).toBeNull();
  });
});

describe("isUuid", () => {
  it("accepts canonical UUIDs only", () => {
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301; drop")).toBe(false);
  });
});

describe("CSV parsing", () => {
  it("parses quoted fields with embedded delimiters and newlines", () => {
    const parsed = parseCsv('first_name,email,notes\n"Pau","pau@acme.es","hola, ""amic""\nsegona línia"\n');
    expect(parsed.headers).toEqual(["first_name", "email", "notes"]);
    expect(parsed.rows[0]).toEqual(["Pau", "pau@acme.es", 'hola, "amic"\nsegona línia']);
  });
  it("detects semicolon delimiters common in Spanish spreadsheets", () => {
    const parsed = parseCsv("nombre;correo\nPau;pau@acme.es\n");
    expect(parsed.headers).toEqual(["nombre", "correo"]);
    expect(parsed.rows).toEqual([["Pau", "pau@acme.es"]]);
  });
  it("strips a UTF-8 byte order mark", () => {
    const text = decodeUtf8(Buffer.from("﻿name,email\nPau,pau@acme.es\n", "utf8"));
    expect(parseCsv(text).headers[0]).toBe("name");
  });
  it("fails on an unclosed quote", () => {
    expect(() => parseCsv('a,b\n"x,y\n')).toThrow(CsvError);
  });
  it("fails on an empty file", () => {
    expect(() => parseCsv("\n\n")).toThrow(/no rows/);
  });
  it("rejects invalid UTF-8", () => {
    expect(() => decodeUtf8(Buffer.from([0xff, 0xfe, 0x00]))).toThrow(CsvError);
  });
  it("rejects more than 5000 rows", () => {
    const body = Array.from({ length: 5001 }, (_, i) => `r${i}`).join("\n");
    expect(() => parseCsv(`name\n${body}\n`)).toThrow(/more than 5000/);
  });
});

describe("csvSafeCell", () => {
  it.each(["=HYPERLINK(\"x\")", "+1", "-2", "@cmd", "\tcmd"])("neutralises formula-like value %s", (value) => {
    // Quoted when it also contains quotes; compare the unquoted form.
    expect(csvSafeCell(value).replace(/^"/, "")).toMatch(/^'/);
  });
  it("quotes values containing separators or quotes", () => {
    expect(csvSafeCell('a,"b"')).toBe('"a,""b"""');
  });
  it("leaves ordinary values alone", () => {
    expect(csvSafeCell("Acme")).toBe("Acme");
    expect(csvSafeCell(null)).toBe("");
  });
});
