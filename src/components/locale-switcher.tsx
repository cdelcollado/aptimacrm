import { setLocaleAction } from "@/app/actions/session";
import { t, type Locale, LOCALES } from "@/i18n";

const NAMES: Record<Locale, string> = { ca: "Català", es: "Español", en: "English" };

/** Plain form: works without JavaScript and returns to the same page after choosing a language. */
export function LocaleSwitcher({ current, next }: { current: Locale; next: string }) {
  return (
    <form action={setLocaleAction} className="inline-form" aria-label={t(current, "nav.language")}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="locale-select" className="sr-only">
        {t(current, "nav.language")}
      </label>
      <select id="locale-select" name="locale" defaultValue={current} style={{ minHeight: 40, width: "auto" }}>
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {NAMES[l]}
          </option>
        ))}
      </select>
      <button type="submit" className="btn secondary small">
        {t(current, "common.apply")}
      </button>
    </form>
  );
}
