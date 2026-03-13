import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // → Dashboard
      { source: "/paper-trade", destination: "/", permanent: true },
      { source: "/mi-performance", destination: "/", permanent: true },
      { source: "/history", destination: "/", permanent: true },
      { source: "/power-rankings", destination: "/", permanent: true },
      { source: "/performance", destination: "/", permanent: true },
      { source: "/standings", destination: "/", permanent: true },
      // → Picks
      { source: "/value", destination: "/picks", permanent: true },
      { source: "/ensemble", destination: "/picks", permanent: true },
      { source: "/live-bets", destination: "/picks", permanent: true },
      { source: "/ted", destination: "/picks", permanent: true },
      { source: "/fixtures", destination: "/picks", permanent: true },
      // → Lab
      { source: "/models", destination: "/lab", permanent: true },
      { source: "/backtest", destination: "/lab", permanent: true },
      { source: "/ted-benchmark", destination: "/lab", permanent: true },
      { source: "/predictor", destination: "/lab", permanent: true },
      // → Data
      { source: "/xg", destination: "/data", permanent: true },
      { source: "/odds-tracker", destination: "/data", permanent: true },
    ];
  },
};

export default nextConfig;
