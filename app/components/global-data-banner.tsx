"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function GlobalDataBanner() {
  const [criticalMessage, setCriticalMessage] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/data-sources");
        if (!res.ok) return;
        const data = await res.json();
        if (data.hasCriticalIssue) {
          setCriticalMessage(data.criticalMessage);
        } else {
          setCriticalMessage(null);
        }
      } catch {
        // Silently fail — don't block app rendering
      }
    }

    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!criticalMessage) return null;

  return (
    <Link
      href="/data"
      className="block bg-red-900/80 px-4 py-1.5 text-center text-xs font-medium text-red-200 transition-colors hover:bg-red-900"
    >
      WARNING: Data source issue detected — check /data for details
    </Link>
  );
}
