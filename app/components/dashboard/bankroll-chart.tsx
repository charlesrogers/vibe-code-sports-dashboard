"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface DailyPnL {
  date: string;
  profit: number;
  cumProfit: number;
  bets: number;
}

export default function BankrollChart({ dailyPnL }: { dailyPnL: DailyPnL[] }) {
  if (dailyPnL.length === 0) return null;

  // Split into positive and negative for dual-color fill
  const data = dailyPnL.map(d => ({
    date: d.date,
    cumProfit: d.cumProfit,
    positive: d.cumProfit >= 0 ? d.cumProfit : 0,
    negative: d.cumProfit < 0 ? d.cumProfit : 0,
    bets: d.bets,
    dailyProfit: d.profit,
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-300">Cumulative P&L</h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="redGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: "#71717a", fontSize: 10 }}
            tickFormatter={(v: string) => v.slice(5)} // MM-DD
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "#71717a", fontSize: 10 }}
            tickFormatter={(v: number) => `${v}u`}
            width={45}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
            labelStyle={{ color: "#a1a1aa", fontSize: 11 }}
            formatter={(value, name) => {
              const v = Number(value);
              if (name === "cumProfit") return [`${v >= 0 ? "+" : ""}${v.toFixed(1)}u`, "Cumulative"];
              return [String(v), String(name)];
            }}
          />
          <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="cumProfit"
            stroke="#22c55e"
            fill="url(#greenGrad)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "#22c55e" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
