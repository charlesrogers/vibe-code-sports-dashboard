"use client";

import type { ModelHealth } from "@/lib/types";

const colors = {
  high: { bg: "bg-green-900/40", border: "border-green-700", text: "text-green-400", dot: "bg-green-400" },
  medium: { bg: "bg-yellow-900/40", border: "border-yellow-700", text: "text-yellow-400", dot: "bg-yellow-400" },
  low: { bg: "bg-red-900/40", border: "border-red-700", text: "text-red-400", dot: "bg-red-400" },
};

export default function ModelHealthBadge({ health }: { health: ModelHealth }) {
  const c = colors[health.confidence];

  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} px-4 py-3`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.dot}`} />
        <span className={`text-sm font-medium ${c.text}`}>
          Model Confidence: {health.confidence.charAt(0).toUpperCase() + health.confidence.slice(1)}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-400">{health.message}</p>
      {health.missingCount > 0 && (
        <div className="mt-2 space-y-1">
          {health.sources
            .filter((s) => !s.available)
            .map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="text-red-500">x</span>
                <span>{s.name}</span>
                {s.detail && <span className="text-zinc-600">— {s.detail}</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
