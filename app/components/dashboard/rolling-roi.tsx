"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";

interface PaperBet {
  matchDate: string;
  status: string;
  profit?: number;
  stake: number;
}

interface RollingPoint {
  date: string;
  roi30?: number;
  roi60?: number;
  roi90?: number;
}

function computeRolling(bets: PaperBet[]): RollingPoint[] {
  const settled = bets
    .filter(b => b.status !== "pending" && b.status !== "superseded")
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate));

  if (settled.length < 30) return [];

  const points: RollingPoint[] = [];
  for (let i = 29; i < settled.length; i++) {
    const date = settled[i].matchDate;
    const point: RollingPoint = { date };

    // 30-bet rolling
    const w30 = settled.slice(i - 29, i + 1);
    const p30 = w30.reduce((s, b) => s + (b.profit || 0), 0);
    const s30 = w30.reduce((s, b) => s + (b.stake || 20), 0);
    point.roi30 = s30 > 0 ? Math.round(p30 / s30 * 10000) / 100 : 0;

    // 60-bet rolling
    if (i >= 59) {
      const w60 = settled.slice(i - 59, i + 1);
      const p60 = w60.reduce((s, b) => s + (b.profit || 0), 0);
      const s60 = w60.reduce((s, b) => s + (b.stake || 20), 0);
      point.roi60 = s60 > 0 ? Math.round(p60 / s60 * 10000) / 100 : 0;
    }

    // 90-bet rolling
    if (i >= 89) {
      const w90 = settled.slice(i - 89, i + 1);
      const p90 = w90.reduce((s, b) => s + (b.profit || 0), 0);
      const s90 = w90.reduce((s, b) => s + (b.stake || 20), 0);
      point.roi90 = s90 > 0 ? Math.round(p90 / s90 * 10000) / 100 : 0;
    }

    points.push(point);
  }

  return points;
}

export default function RollingROI({ bets }: { bets: PaperBet[] }) {
  const data = computeRolling(bets);
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-300">Rolling ROI</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="date"
            tick={{ fill: "#71717a", fontSize: 10 }}
            tickFormatter={(v: string) => v.slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "#71717a", fontSize: 10 }}
            tickFormatter={(v: number) => `${v}%`}
            width={45}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
            labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
          />
          <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1.5} />
          <Legend
            wrapperStyle={{ fontSize: 10, color: "#a1a1aa" }}
          />
          <Line type="monotone" dataKey="roi30" name="30-bet" stroke="#60a5fa" strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="roi60" name="60-bet" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="roi90" name="90-bet" stroke="#fbbf24" strokeWidth={1.5} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
