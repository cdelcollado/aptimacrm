/**
 * RFC 4180 CSV parser with the limits the brief requires: UTF-8 (BOM stripped), header row,
 * size and row caps enforced before parsing completes. Pure, so it is unit-tested directly.
 */

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 5000;

export class CsvError extends Error {
  constructor(readonly code: "too_large" | "too_many_rows" | "empty" | "malformed" | "no_header" | "bad_encoding", message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function decodeUtf8(buffer: Buffer): string {
  if (buffer.byteLength > MAX_BYTES) throw new CsvError("too_large", `File is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer).replace(/^﻿/, "");
  } catch {
    throw new CsvError("bad_encoding", "File must be UTF-8 encoded");
  }
}

/** Detect the delimiter from the header line: comma, semicolon (common in Spain) or tab. */
export function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<string, number>;
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]! += 1;
  }
  if (counts[";"]! > counts[","]! && counts[";"]! >= counts["\t"]!) return ";";
  if (counts["\t"]! > counts[","]! && counts["\t"]! > counts[";"]!) return "\t";
  return ",";
}

export function parseCsv(text: string): ParsedCsv {
  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const records = splitRecords(text, delimiter);
  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) throw new CsvError("empty", "The file has no rows");
  const [headerRow, ...rest] = nonEmpty;
  const headers = headerRow!.map((h) => h.trim());
  if (headers.every((h) => h === "")) throw new CsvError("no_header", "The first row must contain column names");
  if (rest.length > MAX_ROWS) throw new CsvError("too_many_rows", `The file has more than ${MAX_ROWS} rows`);
  return { headers, rows: rest };
}

function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (cell.length > 0) throw new CsvError("malformed", "Unexpected quote inside a value");
      inQuotes = true;
      i += 1;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i += 1;
    } else if (ch === "\r" || ch === "\n") {
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += ch;
      i += 1;
    }
  }
  if (inQuotes) throw new CsvError("malformed", "A quoted value is not closed");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  return records;
}

/** Neutralise spreadsheet formula injection for CSV export (OWASP). */
export function csvSafeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",;\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}
