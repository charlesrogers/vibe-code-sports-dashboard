"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/picks", label: "Picks" },
  { href: "/lab", label: "Lab" },
  { href: "/data", label: "Data" },
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
