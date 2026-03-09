"use client";

interface Props {
  grid: number[][];
  homeTeam: string;
  awayTeam: string;
}

export default function ProbabilityGrid({ grid, homeTeam, awayTeam }: Props) {
  const maxP = Math.max(...grid.flat());
  const displaySize = Math.min(grid.length, 7);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="px-1 py-1 text-zinc-500">{homeTeam} \ {awayTeam}</th>
            {Array.from({ length: displaySize }, (_, i) => (
              <th key={i} className="px-2 py-1 text-center text-zinc-400">{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.slice(0, displaySize).map((row, h) => (
            <tr key={h}>
              <td className="px-2 py-1 font-medium text-zinc-400">{h}</td>
              {row.slice(0, displaySize).map((p, a) => {
                const intensity = maxP > 0 ? p / maxP : 0;
                const bg = h > a
                  ? `rgba(34, 197, 94, ${intensity * 0.7})`  // green for home win
                  : h === a
                  ? `rgba(250, 204, 21, ${intensity * 0.7})` // yellow for draw
                  : `rgba(59, 130, 246, ${intensity * 0.7})`; // blue for away win
                return (
                  <td
                    key={a}
                    className="px-2 py-1 text-center font-mono"
                    style={{ backgroundColor: bg }}
                  >
                    {(p * 100).toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
