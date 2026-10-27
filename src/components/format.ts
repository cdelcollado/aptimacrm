/** Date and time formatting in the org timezone, using the viewer's locale tag. */
export function formatDateTime(value: Date | string, tag: string, timeZone = "Europe/Madrid"): string {
  return new Date(value).toLocaleString(tag, { timeZone, dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(value: Date | string | null, tag: string, timeZone = "Europe/Madrid"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value;
  return d.toLocaleDateString(tag, { timeZone, dateStyle: "medium" });
}
