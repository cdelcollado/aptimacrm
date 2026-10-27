import { requirePrincipal } from "@/server/web/guard";
import { currentLocale } from "@/i18n";
import { AppShell } from "@/components/app-shell";

/** Every page under (app) requires a session. Sessions are re-checked per request. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePrincipal();
  const locale = await currentLocale(principal.locale);
  return (
    <AppShell principal={principal} locale={locale}>
      {children}
    </AppShell>
  );
}
