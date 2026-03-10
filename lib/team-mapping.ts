// Canonical team names and mappings from each data source
// Key = canonical name used throughout the app

type SourceMap = {
  footballData: string;
  openfootball: string;
  understat: string;
  fotmob: string;
};

const TEAM_MAP: Record<string, SourceMap> = {
  "Atalanta": { footballData: "Atalanta BC", openfootball: "Atalanta BC", understat: "Atalanta", fotmob: "Atalanta" },
  "Bologna": { footballData: "Bologna FC 1909", openfootball: "Bologna FC 1909", understat: "Bologna", fotmob: "Bologna" },
  "Cagliari": { footballData: "Cagliari Calcio", openfootball: "Cagliari Calcio", understat: "Cagliari", fotmob: "Cagliari" },
  "Como": { footballData: "Como 1907", openfootball: "Como 1907", understat: "Como", fotmob: "Como" },
  "Empoli": { footballData: "Empoli FC", openfootball: "Empoli FC", understat: "Empoli", fotmob: "Empoli" },
  "Fiorentina": { footballData: "ACF Fiorentina", openfootball: "ACF Fiorentina", understat: "Fiorentina", fotmob: "Fiorentina" },
  "Genoa": { footballData: "Genoa CFC", openfootball: "Genoa CFC", understat: "Genoa", fotmob: "Genoa" },
  "Inter": { footballData: "FC Internazionale Milano", openfootball: "FC Internazionale Milano", understat: "Inter", fotmob: "Inter" },
  "Juventus": { footballData: "Juventus FC", openfootball: "Juventus FC", understat: "Juventus", fotmob: "Juventus" },
  "Lazio": { footballData: "SS Lazio", openfootball: "SS Lazio", understat: "Lazio", fotmob: "Lazio" },
  "Lecce": { footballData: "US Lecce", openfootball: "US Lecce", understat: "Lecce", fotmob: "Lecce" },
  "Milan": { footballData: "AC Milan", openfootball: "AC Milan", understat: "AC Milan", fotmob: "Milan" },
  "Monza": { footballData: "AC Monza", openfootball: "AC Monza", understat: "Monza", fotmob: "Monza" },
  "Napoli": { footballData: "SSC Napoli", openfootball: "SSC Napoli", understat: "Napoli", fotmob: "Napoli" },
  "Parma": { footballData: "Parma Calcio 1913", openfootball: "Parma Calcio 1913", understat: "Parma", fotmob: "Parma" },
  "Roma": { footballData: "AS Roma", openfootball: "AS Roma", understat: "Roma", fotmob: "Roma" },
  "Torino": { footballData: "Torino FC", openfootball: "Torino FC", understat: "Torino", fotmob: "Torino" },
  "Udinese": { footballData: "Udinese Calcio", openfootball: "Udinese Calcio", understat: "Udinese", fotmob: "Udinese" },
  "Venezia": { footballData: "Venezia FC", openfootball: "Venezia FC", understat: "Venezia", fotmob: "Venezia" },
  "Verona": { footballData: "Hellas Verona FC", openfootball: "Hellas Verona FC", understat: "Verona", fotmob: "Hellas Verona" },
  "Pisa": { footballData: "AC Pisa 1909", openfootball: "AC Pisa 1909", understat: "Pisa", fotmob: "Pisa" },
  // Previous season teams that may appear in historical data
  "Salernitana": { footballData: "US Salernitana 1919", openfootball: "US Salernitana 1919", understat: "Salernitana", fotmob: "Salernitana" },
  "Sassuolo": { footballData: "US Sassuolo Calcio", openfootball: "US Sassuolo Calcio", understat: "Sassuolo", fotmob: "Sassuolo" },
  "Frosinone": { footballData: "Frosinone Calcio", openfootball: "Frosinone Calcio", understat: "Frosinone", fotmob: "Frosinone" },
  "Cremonese": { footballData: "US Cremonese", openfootball: "US Cremonese", understat: "Cremonese", fotmob: "Cremonese" },
  "Sampdoria": { footballData: "UC Sampdoria", openfootball: "Sampdoria", understat: "Sampdoria", fotmob: "Sampdoria" },
  "Spezia": { footballData: "Spezia Calcio", openfootball: "Spezia Calcio", understat: "Spezia", fotmob: "Spezia" },
  // Serie B teams
  "Bari": { footballData: "SSC Bari", openfootball: "SSC Bari", understat: "Bari", fotmob: "Bari" },
  "Palermo": { footballData: "Palermo FC", openfootball: "Palermo FC", understat: "Palermo", fotmob: "Palermo" },
  "Brescia": { footballData: "Brescia Calcio", openfootball: "Brescia Calcio", understat: "Brescia", fotmob: "Brescia" },
  "Cittadella": { footballData: "AS Cittadella", openfootball: "AS Cittadella", understat: "Cittadella", fotmob: "Cittadella" },
  "Cosenza": { footballData: "Cosenza Calcio", openfootball: "Cosenza Calcio", understat: "Cosenza", fotmob: "Cosenza" },
  "Reggiana": { footballData: "AC Reggiana 1919", openfootball: "AC Reggiana 1919", understat: "Reggiana", fotmob: "Reggiana" },
  "Catanzaro": { footballData: "US Catanzaro", openfootball: "US Catanzaro", understat: "Catanzaro", fotmob: "Catanzaro" },
  "Sudtirol": { footballData: "FC Südtirol", openfootball: "FC Südtirol", understat: "Sudtirol", fotmob: "Südtirol" },
  "Modena": { footballData: "Modena FC", openfootball: "Modena FC", understat: "Modena", fotmob: "Modena" },
  "Carrarese": { footballData: "Carrarese Calcio", openfootball: "Carrarese Calcio", understat: "Carrarese", fotmob: "Carrarese" },
  "Juve Stabia": { footballData: "Juve Stabia", openfootball: "Juve Stabia", understat: "Juve Stabia", fotmob: "Juve Stabia" },
  "Mantova": { footballData: "Mantova 1911 SSD", openfootball: "Mantova 1911 SSD", understat: "Mantova", fotmob: "Mantova" },
  "Cesena": { footballData: "Cesena FC", openfootball: "Cesena FC", understat: "Cesena", fotmob: "Cesena" },
  "Padova": { footballData: "Calcio Padova", openfootball: "Calcio Padova", understat: "Padova", fotmob: "Padova" },
  "Pescara": { footballData: "Delfino Pescara", openfootball: "Delfino Pescara", understat: "Pescara", fotmob: "Pescara" },
  "Avellino": { footballData: "US Avellino", openfootball: "US Avellino", understat: "Avellino", fotmob: "Avellino" },
  "Virtus Entella": { footballData: "Virtus Entella", openfootball: "Virtus Entella", understat: "Virtus Entella", fotmob: "Virtus Entella" },
  // ─── EPL teams ───────────────────────────────────────────────────────────
  "Arsenal": { footballData: "Arsenal", openfootball: "Arsenal", understat: "Arsenal", fotmob: "Arsenal" },
  "Aston Villa": { footballData: "Aston Villa", openfootball: "Aston Villa", understat: "Aston Villa", fotmob: "Aston Villa" },
  "Bournemouth": { footballData: "Bournemouth", openfootball: "Bournemouth", understat: "Bournemouth", fotmob: "Bournemouth" },
  "Brentford": { footballData: "Brentford", openfootball: "Brentford", understat: "Brentford", fotmob: "Brentford" },
  "Brighton": { footballData: "Brighton", openfootball: "Brighton", understat: "Brighton", fotmob: "Brighton" },
  "Burnley": { footballData: "Burnley", openfootball: "Burnley", understat: "Burnley", fotmob: "Burnley" },
  "Chelsea": { footballData: "Chelsea", openfootball: "Chelsea", understat: "Chelsea", fotmob: "Chelsea" },
  "Crystal Palace": { footballData: "Crystal Palace", openfootball: "Crystal Palace", understat: "Crystal Palace", fotmob: "Crystal Palace" },
  "Everton": { footballData: "Everton", openfootball: "Everton", understat: "Everton", fotmob: "Everton" },
  "Fulham": { footballData: "Fulham", openfootball: "Fulham", understat: "Fulham", fotmob: "Fulham" },
  "Ipswich": { footballData: "Ipswich", openfootball: "Ipswich", understat: "Ipswich", fotmob: "Ipswich Town" },
  "Leeds": { footballData: "Leeds", openfootball: "Leeds", understat: "Leeds", fotmob: "Leeds United" },
  "Leicester": { footballData: "Leicester", openfootball: "Leicester", understat: "Leicester", fotmob: "Leicester City" },
  "Liverpool": { footballData: "Liverpool", openfootball: "Liverpool", understat: "Liverpool", fotmob: "Liverpool" },
  "Luton": { footballData: "Luton", openfootball: "Luton", understat: "Luton", fotmob: "Luton Town" },
  "Manchester City": { footballData: "Manchester City", openfootball: "Manchester City", understat: "Manchester City", fotmob: "Manchester City" },
  "Manchester United": { footballData: "Manchester United", openfootball: "Manchester United", understat: "Manchester United", fotmob: "Manchester United" },
  "Newcastle United": { footballData: "Newcastle United", openfootball: "Newcastle United", understat: "Newcastle United", fotmob: "Newcastle United" },
  "Nottingham Forest": { footballData: "Nottingham Forest", openfootball: "Nottingham Forest", understat: "Nottingham Forest", fotmob: "Nottingham Forest" },
  "Sheffield United": { footballData: "Sheffield United", openfootball: "Sheffield United", understat: "Sheffield United", fotmob: "Sheffield United" },
  "Southampton": { footballData: "Southampton", openfootball: "Southampton", understat: "Southampton", fotmob: "Southampton" },
  "Tottenham": { footballData: "Tottenham", openfootball: "Tottenham", understat: "Tottenham", fotmob: "Tottenham" },
  "West Ham": { footballData: "West Ham", openfootball: "West Ham", understat: "West Ham", fotmob: "West Ham United" },
  "Wolverhampton Wanderers": { footballData: "Wolverhampton Wanderers", openfootball: "Wolverhampton Wanderers", understat: "Wolverhampton Wanderers", fotmob: "Wolverhampton" },
  // ─── Championship teams ──────────────────────────────────────────────────
  "Birmingham": { footballData: "Birmingham", openfootball: "Birmingham", understat: "Birmingham", fotmob: "Birmingham City" },
  "Blackburn": { footballData: "Blackburn", openfootball: "Blackburn", understat: "Blackburn", fotmob: "Blackburn Rovers" },
  "Bristol City": { footballData: "Bristol City", openfootball: "Bristol City", understat: "Bristol City", fotmob: "Bristol City" },
  "Cardiff": { footballData: "Cardiff", openfootball: "Cardiff", understat: "Cardiff", fotmob: "Cardiff City" },
  "Coventry": { footballData: "Coventry", openfootball: "Coventry", understat: "Coventry", fotmob: "Coventry City" },
  "Derby": { footballData: "Derby", openfootball: "Derby", understat: "Derby", fotmob: "Derby County" },
  "Huddersfield": { footballData: "Huddersfield", openfootball: "Huddersfield", understat: "Huddersfield", fotmob: "Huddersfield Town" },
  "Hull City": { footballData: "Hull City", openfootball: "Hull City", understat: "Hull City", fotmob: "Hull City" },
  "Middlesbrough": { footballData: "Middlesbrough", openfootball: "Middlesbrough", understat: "Middlesbrough", fotmob: "Middlesbrough" },
  "Millwall": { footballData: "Millwall", openfootball: "Millwall", understat: "Millwall", fotmob: "Millwall" },
  "Norwich": { footballData: "Norwich", openfootball: "Norwich", understat: "Norwich", fotmob: "Norwich City" },
  "Oxford United": { footballData: "Oxford United", openfootball: "Oxford United", understat: "Oxford United", fotmob: "Oxford United" },
  "Plymouth": { footballData: "Plymouth", openfootball: "Plymouth", understat: "Plymouth", fotmob: "Plymouth Argyle" },
  "Portsmouth": { footballData: "Portsmouth", openfootball: "Portsmouth", understat: "Portsmouth", fotmob: "Portsmouth" },
  "Preston": { footballData: "Preston", openfootball: "Preston", understat: "Preston", fotmob: "Preston North End" },
  "QPR": { footballData: "QPR", openfootball: "QPR", understat: "QPR", fotmob: "QPR" },
  "Rotherham": { footballData: "Rotherham", openfootball: "Rotherham", understat: "Rotherham", fotmob: "Rotherham United" },
  "Sheffield Wednesday": { footballData: "Sheffield Wednesday", openfootball: "Sheffield Wednesday", understat: "Sheffield Wednesday", fotmob: "Sheffield Wednesday" },
  "Stoke": { footballData: "Stoke", openfootball: "Stoke", understat: "Stoke", fotmob: "Stoke City" },
  "Sunderland": { footballData: "Sunderland", openfootball: "Sunderland", understat: "Sunderland", fotmob: "Sunderland" },
  "Swansea": { footballData: "Swansea", openfootball: "Swansea", understat: "Swansea", fotmob: "Swansea City" },
  "Watford": { footballData: "Watford", openfootball: "Watford", understat: "Watford", fotmob: "Watford" },
  "West Brom": { footballData: "West Brom", openfootball: "West Brom", understat: "West Brom", fotmob: "West Bromwich Albion" },
};

// Build reverse lookup maps
const footballDataToCanonical = new Map<string, string>();
const openfootballToCanonical = new Map<string, string>();
const understatToCanonical = new Map<string, string>();
const fotmobToCanonical = new Map<string, string>();

for (const [canonical, sources] of Object.entries(TEAM_MAP)) {
  footballDataToCanonical.set(sources.footballData, canonical);
  openfootballToCanonical.set(sources.openfootball, canonical);
  understatToCanonical.set(sources.understat, canonical);
  fotmobToCanonical.set(sources.fotmob, canonical);
}

export function normalizeTeamName(name: string, source: "footballData" | "openfootball" | "understat" | "fotmob"): string {
  const map = source === "footballData" ? footballDataToCanonical
    : source === "openfootball" ? openfootballToCanonical
    : source === "fotmob" ? fotmobToCanonical
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
