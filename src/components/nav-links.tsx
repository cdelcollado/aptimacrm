"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

/** Highlights the current section. Matching is by first path segment, so /contacts/123 marks Contacts. */
export function NavLinks({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  const section = "/" + (pathname.split("/")[1] ?? "");
  return (
    <nav className="main-nav" aria-label={label}>
      {items.map((item) => {
        const active = section === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
