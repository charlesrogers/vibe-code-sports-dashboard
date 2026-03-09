"use client";

const SEASONS = [
  "2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21", "2019-20", "2018-19",
];

interface Props {
  value: string;
  onChange: (season: string) => void;
}

export default function SeasonSelector({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
    >
      {SEASONS.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}
