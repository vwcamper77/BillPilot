"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const DESTINATIONS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/bills-income", label: "Bills & income" },
  { href: "/dashboard/large-costs-savings", label: "Large costs & savings" },
  { href: "/account", label: "Account" },
];

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="finance-nav" aria-label="ClearTill account">
      {DESTINATIONS.map((destination) => {
        const active = pathname === destination.href;
        return (
          <Link
            key={destination.href}
            href={destination.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {destination.label}
          </Link>
        );
      })}
    </nav>
  );
}
