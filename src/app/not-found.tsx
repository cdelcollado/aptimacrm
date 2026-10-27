import Link from "next/link";
import { currentLocale, t } from "@/i18n";
import { PageHeader } from "@/components/page-header";

export default async function NotFound() {
  const locale = await currentLocale();
  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "notFound.title")} intro={t(locale, "notFound.body")} />
      <p><Link className="btn" href="/dashboard">{t(locale, "nav.dashboard")}</Link></p>
    </main>
  );
}
