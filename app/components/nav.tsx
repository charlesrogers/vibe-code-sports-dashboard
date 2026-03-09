"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Standings" },
  { href: "/live-bets", label: "Live Bets" },
  { href: "/backtest", label: "Backtest" },
  { href: "/odds-tracker", label: "Odds Tracker" },
  { href: "/power-rankings", label: "Rankings" },
  { href: "/predictor", label: "Predictor" },
  { href: "/value", label: "Value Bets" },
  { href: "/ted", label: "Ted" },
  { href: "/history", label: "History" },
  { href: "/xg", label: "xG" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/performance", label: "Model" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex overflow-x-auto border-b border-zinc-800 px-4">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors ${
            pathname === link.href
              ? "border-b-2 border-blue-500 text-white"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
