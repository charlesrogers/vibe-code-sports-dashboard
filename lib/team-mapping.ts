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
  "Sampdoria": { footballData: "UC Sampdoria", openfootball: "Sampdoria", understat: "Sampdoria" },
  "Spezia": { footballData: "Spezia Calcio", openfootball: "Spezia Calcio", understat: "Spezia" },
  // Serie B teams
  "Bari": { footballData: "SSC Bari", openfootball: "SSC Bari", understat: "Bari" },
  "Palermo": { footballData: "Palermo FC", openfootball: "Palermo FC", understat: "Palermo" },
  "Brescia": { footballData: "Brescia Calcio", openfootball: "Brescia Calcio", understat: "Brescia" },
  "Cittadella": { footballData: "AS Cittadella", openfootball: "AS Cittadella", understat: "Cittadella" },
  "Cosenza": { footballData: "Cosenza Calcio", openfootball: "Cosenza Calcio", understat: "Cosenza" },
  "Reggiana": { footballData: "AC Reggiana 1919", openfootball: "AC Reggiana 1919", understat: "Reggiana" },
  "Catanzaro": { footballData: "US Catanzaro", openfootball: "US Catanzaro", understat: "Catanzaro" },
  "Sudtirol": { footballData: "FC Südtirol", openfootball: "FC Südtirol", understat: "Sudtirol" },
  "Modena": { footballData: "Modena FC", openfootball: "Modena FC", understat: "Modena" },
  "Carrarese": { footballData: "Carrarese Calcio", openfootball: "Carrarese Calcio", understat: "Carrarese" },
  "Juve Stabia": { footballData: "Juve Stabia", openfootball: "Juve Stabia", understat: "Juve Stabia" },
  "Mantova": { footballData: "Mantova 1911 SSD", openfootball: "Mantova 1911 SSD", understat: "Mantova" },
  "Cesena": { footballData: "Cesena FC", openfootball: "Cesena FC", understat: "Cesena" },
  "Padova": { footballData: "Calcio Padova", openfootball: "Calcio Padova", understat: "Padova" },
  "Pescara": { footballData: "Delfino Pescara", openfootball: "Delfino Pescara", understat: "Pescara" },
  "Avellino": { footballData: "US Avellino", openfootball: "US Avellino", understat: "Avellino" },
  "Virtus Entella": { footballData: "Virtus Entella", openfootball: "Virtus Entella", understat: "Virtus Entella" },
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
