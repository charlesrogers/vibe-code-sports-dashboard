// Canonical team names and mappings from each data source
// Key = canonical name used throughout the app

type SourceMap = {
  footballData: string;
  openfootball: string;
  understat: string;
};

const TEAM_MAP: Record<string, SourceMap> = {
  "Atalanta": { footballData: "Atalanta BC", openfootball: "Atalanta BC", understat: "Atalanta" },
  "Bologna": { footballData: "Bologna FC 1909", openfootball: "Bologna FC 1909", understat: "Bologna" },
  "Cagliari": { footballData: "Cagliari Calcio", openfootball: "Cagliari Calcio", understat: "Cagliari" },
  "Como": { footballData: "Como 1907", openfootball: "Como 1907", understat: "Como" },
  "Empoli": { footballData: "Empoli FC", openfootball: "Empoli FC", understat: "Empoli" },
  "Fiorentina": { footballData: "ACF Fiorentina", openfootball: "ACF Fiorentina", understat: "Fiorentina" },
  "Genoa": { footballData: "Genoa CFC", openfootball: "Genoa CFC", understat: "Genoa" },
  "Inter": { footballData: "FC Internazionale Milano", openfootball: "FC Internazionale Milano", understat: "Inter" },
  "Juventus": { footballData: "Juventus FC", openfootball: "Juventus FC", understat: "Juventus" },
  "Lazio": { footballData: "SS Lazio", openfootball: "SS Lazio", understat: "Lazio" },
  "Lecce": { footballData: "US Lecce", openfootball: "US Lecce", understat: "Lecce" },
  "Milan": { footballData: "AC Milan", openfootball: "AC Milan", understat: "AC Milan" },
  "Monza": { footballData: "AC Monza", openfootball: "AC Monza", understat: "Monza" },
  "Napoli": { footballData: "SSC Napoli", openfootball: "SSC Napoli", understat: "Napoli" },
  "Parma": { footballData: "Parma Calcio 1913", openfootball: "Parma Calcio 1913", understat: "Parma" },
  "Roma": { footballData: "AS Roma", openfootball: "AS Roma", understat: "Roma" },
  "Torino": { footballData: "Torino FC", openfootball: "Torino FC", understat: "Torino" },
  "Udinese": { footballData: "Udinese Calcio", openfootball: "Udinese Calcio", understat: "Udinese" },
  "Venezia": { footballData: "Venezia FC", openfootball: "Venezia FC", understat: "Venezia" },
  "Verona": { footballData: "Hellas Verona FC", openfootball: "Hellas Verona FC", understat: "Verona" },
  "Pisa": { footballData: "AC Pisa 1909", openfootball: "AC Pisa 1909", understat: "Pisa" },
  // Previous season teams that may appear in historical data
  "Salernitana": { footballData: "US Salernitana 1919", openfootball: "US Salernitana 1919", understat: "Salernitana" },
  "Sassuolo": { footballData: "US Sassuolo Calcio", openfootball: "US Sassuolo Calcio", understat: "Sassuolo" },
  "Frosinone": { footballData: "Frosinone Calcio", openfootball: "Frosinone Calcio", understat: "Frosinone" },
  "Cremonese": { footballData: "US Cremonese", openfootball: "US Cremonese", understat: "Cremonese" },
  "Sampdoria": { footballData: "UC Sampdoria", openfootball: "UC Sampdoria", understat: "Sampdoria" },
  "Spezia": { footballData: "Spezia Calcio", openfootball: "Spezia Calcio", understat: "Spezia" },
};

// Build reverse lookup maps
const footballDataToCanonical = new Map<string, string>();
const openfootballToCanonical = new Map<string, string>();
const understatToCanonical = new Map<string, string>();

for (const [canonical, sources] of Object.entries(TEAM_MAP)) {
  footballDataToCanonical.set(sources.footballData, canonical);
  openfootballToCanonical.set(sources.openfootball, canonical);
  understatToCanonical.set(sources.understat, canonical);
}

export function normalizeTeamName(name: string, source: "footballData" | "openfootball" | "understat"): string {
  const map = source === "footballData" ? footballDataToCanonical
    : source === "openfootball" ? openfootballToCanonical
    : understatToCanonical;
  return map.get(name) ?? name;
}

export function getCanonicalTeams(): string[] {
  return Object.keys(TEAM_MAP).sort();
}

export function getSerieATeams2024(): string[] {
  return [
    "Atalanta", "Bologna", "Cagliari", "Como", "Empoli",
    "Fiorentina", "Genoa", "Inter", "Juventus", "Lazio",
    "Lecce", "Milan", "Monza", "Napoli", "Parma",
    "Roma", "Torino", "Udinese", "Venezia", "Verona",
  ];
}
