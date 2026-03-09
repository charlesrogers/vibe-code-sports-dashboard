"use client";

const LEAGUES = [
  { value: "serieA", label: "Serie A" },
  { value: "serieB", label: "Serie B" },
] as const;

interface Props {
  value: string;
  onChange: (league: string) => void;
}

export default function LeagueSelector({ value, onChange }: Props) {
  return (
    <div className="flex gap-1">
      {LEAGUES.map((l) => (
        <button
          key={l.value}
          onClick={() => onChange(l.value)}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            value === l.value
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:text-white"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
