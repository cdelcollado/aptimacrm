/** Object key for an import's source file. Server-generated, never user-supplied. */
export function importObjectKey(importId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new Error("invalid import id");
  return `imports/${importId}.csv`;
}
