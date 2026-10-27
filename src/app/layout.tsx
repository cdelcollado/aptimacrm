import type { Metadata, Viewport } from "next";
import "./globals.css";
import { currentLocale } from "@/i18n";

export const metadata: Metadata = {
  title: { default: "AptimaCRM", template: "%s · AptimaCRM" },
  description: "A focused CRM for a small sales team.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
