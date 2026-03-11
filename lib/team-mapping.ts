// Canonical team names and mappings from each data source
// Key = canonical name used throughout the app
// "mi" = short names used in MI picks engine (from football-data-cache / Odds API normalization)

type SourceMap = {
  footballData: string;
  openfootball: string;
  understat: string;
  fotmob: string;
  mi: string;
};

const TEAM_MAP: Record<string, SourceMap> = {
  // ─── Serie A ────────────────────────────────────────────────────────────────
  "Atalanta": { footballData: "Atalanta BC", openfootball: "Atalanta BC", understat: "Atalanta", fotmob: "Atalanta", mi: "Atalanta" },
  "Bologna": { footballData: "Bologna FC 1909", openfootball: "Bologna FC 1909", understat: "Bologna", fotmob: "Bologna", mi: "Bologna" },
  "Cagliari": { footballData: "Cagliari Calcio", openfootball: "Cagliari Calcio", understat: "Cagliari", fotmob: "Cagliari", mi: "Cagliari" },
  "Como": { footballData: "Como 1907", openfootball: "Como 1907", understat: "Como", fotmob: "Como", mi: "Como" },
  "Empoli": { footballData: "Empoli FC", openfootball: "Empoli FC", understat: "Empoli", fotmob: "Empoli", mi: "Empoli" },
  "Fiorentina": { footballData: "ACF Fiorentina", openfootball: "ACF Fiorentina", understat: "Fiorentina", fotmob: "Fiorentina", mi: "Fiorentina" },
  "Genoa": { footballData: "Genoa CFC", openfootball: "Genoa CFC", understat: "Genoa", fotmob: "Genoa", mi: "Genoa" },
  "Inter": { footballData: "FC Internazionale Milano", openfootball: "FC Internazionale Milano", understat: "Inter", fotmob: "Inter", mi: "Inter" },
  "Juventus": { footballData: "Juventus FC", openfootball: "Juventus FC", understat: "Juventus", fotmob: "Juventus", mi: "Juventus" },
  "Lazio": { footballData: "SS Lazio", openfootball: "SS Lazio", understat: "Lazio", fotmob: "Lazio", mi: "Lazio" },
  "Lecce": { footballData: "US Lecce", openfootball: "US Lecce", understat: "Lecce", fotmob: "Lecce", mi: "Lecce" },
  "Milan": { footballData: "AC Milan", openfootball: "AC Milan", understat: "AC Milan", fotmob: "Milan", mi: "Milan" },
  "Monza": { footballData: "AC Monza", openfootball: "AC Monza", understat: "Monza", fotmob: "Monza", mi: "Monza" },
  "Napoli": { footballData: "SSC Napoli", openfootball: "SSC Napoli", understat: "Napoli", fotmob: "Napoli", mi: "Napoli" },
  "Parma": { footballData: "Parma Calcio 1913", openfootball: "Parma Calcio 1913", understat: "Parma", fotmob: "Parma", mi: "Parma" },
  "Roma": { footballData: "AS Roma", openfootball: "AS Roma", understat: "Roma", fotmob: "Roma", mi: "Roma" },
  "Torino": { footballData: "Torino FC", openfootball: "Torino FC", understat: "Torino", fotmob: "Torino", mi: "Torino" },
  "Udinese": { footballData: "Udinese Calcio", openfootball: "Udinese Calcio", understat: "Udinese", fotmob: "Udinese", mi: "Udinese" },
  "Venezia": { footballData: "Venezia FC", openfootball: "Venezia FC", understat: "Venezia", fotmob: "Venezia", mi: "Venezia" },
  "Verona": { footballData: "Hellas Verona FC", openfootball: "Hellas Verona FC", understat: "Verona", fotmob: "Hellas Verona", mi: "Verona" },
  "Pisa": { footballData: "AC Pisa 1909", openfootball: "AC Pisa 1909", understat: "Pisa", fotmob: "Pisa", mi: "Pisa" },
  // Previous season Serie A/B
  "Salernitana": { footballData: "US Salernitana 1919", openfootball: "US Salernitana 1919", understat: "Salernitana", fotmob: "Salernitana", mi: "Salernitana" },
  "Sassuolo": { footballData: "US Sassuolo Calcio", openfootball: "US Sassuolo Calcio", understat: "Sassuolo", fotmob: "Sassuolo", mi: "Sassuolo" },
  "Frosinone": { footballData: "Frosinone Calcio", openfootball: "Frosinone Calcio", understat: "Frosinone", fotmob: "Frosinone", mi: "Frosinone" },
  "Cremonese": { footballData: "US Cremonese", openfootball: "US Cremonese", understat: "Cremonese", fotmob: "Cremonese", mi: "Cremonese" },
  "Sampdoria": { footballData: "UC Sampdoria", openfootball: "Sampdoria", understat: "Sampdoria", fotmob: "Sampdoria", mi: "Sampdoria" },
  "Spezia": { footballData: "Spezia Calcio", openfootball: "Spezia Calcio", understat: "Spezia", fotmob: "Spezia", mi: "Spezia" },
  // Serie B teams
  "Bari": { footballData: "SSC Bari", openfootball: "SSC Bari", understat: "Bari", fotmob: "Bari", mi: "Bari" },
  "Palermo": { footballData: "Palermo FC", openfootball: "Palermo FC", understat: "Palermo", fotmob: "Palermo", mi: "Palermo" },
  "Brescia": { footballData: "Brescia Calcio", openfootball: "Brescia Calcio", understat: "Brescia", fotmob: "Brescia", mi: "Brescia" },
  "Cittadella": { footballData: "AS Cittadella", openfootball: "AS Cittadella", understat: "Cittadella", fotmob: "Cittadella", mi: "Cittadella" },
  "Cosenza": { footballData: "Cosenza Calcio", openfootball: "Cosenza Calcio", understat: "Cosenza", fotmob: "Cosenza", mi: "Cosenza" },
  "Reggiana": { footballData: "AC Reggiana 1919", openfootball: "AC Reggiana 1919", understat: "Reggiana", fotmob: "Reggiana", mi: "Reggiana" },
  "Catanzaro": { footballData: "US Catanzaro", openfootball: "US Catanzaro", understat: "Catanzaro", fotmob: "Catanzaro", mi: "Catanzaro" },
  "Sudtirol": { footballData: "FC Südtirol", openfootball: "FC Südtirol", understat: "Sudtirol", fotmob: "Südtirol", mi: "Sudtirol" },
  "Modena": { footballData: "Modena FC", openfootball: "Modena FC", understat: "Modena", fotmob: "Modena", mi: "Modena" },
  "Carrarese": { footballData: "Carrarese Calcio", openfootball: "Carrarese Calcio", understat: "Carrarese", fotmob: "Carrarese", mi: "Carrarese" },
  "Juve Stabia": { footballData: "Juve Stabia", openfootball: "Juve Stabia", understat: "Juve Stabia", fotmob: "Juve Stabia", mi: "Juve Stabia" },
  "Mantova": { footballData: "Mantova 1911 SSD", openfootball: "Mantova 1911 SSD", understat: "Mantova", fotmob: "Mantova", mi: "Mantova" },
  "Cesena": { footballData: "Cesena FC", openfootball: "Cesena FC", understat: "Cesena", fotmob: "Cesena", mi: "Cesena" },
  "Padova": { footballData: "Calcio Padova", openfootball: "Calcio Padova", understat: "Padova", fotmob: "Padova", mi: "Padova" },
  "Pescara": { footballData: "Delfino Pescara", openfootball: "Delfino Pescara", understat: "Pescara", fotmob: "Pescara", mi: "Pescara" },
  "Avellino": { footballData: "US Avellino", openfootball: "US Avellino", understat: "Avellino", fotmob: "Avellino", mi: "Avellino" },
  "Virtus Entella": { footballData: "Virtus Entella", openfootball: "Virtus Entella", understat: "Virtus Entella", fotmob: "Virtus Entella", mi: "Virtus Entella" },
  // ─── EPL teams ───────────────────────────────────────────────────────────
  "Arsenal": { footballData: "Arsenal", openfootball: "Arsenal", understat: "Arsenal", fotmob: "Arsenal", mi: "Arsenal" },
  "Aston Villa": { footballData: "Aston Villa", openfootball: "Aston Villa", understat: "Aston Villa", fotmob: "Aston Villa", mi: "Aston Villa" },
  "Bournemouth": { footballData: "Bournemouth", openfootball: "Bournemouth", understat: "Bournemouth", fotmob: "Bournemouth", mi: "Bournemouth" },
  "Brentford": { footballData: "Brentford", openfootball: "Brentford", understat: "Brentford", fotmob: "Brentford", mi: "Brentford" },
  "Brighton": { footballData: "Brighton", openfootball: "Brighton", understat: "Brighton", fotmob: "Brighton", mi: "Brighton" },
  "Burnley": { footballData: "Burnley", openfootball: "Burnley", understat: "Burnley", fotmob: "Burnley", mi: "Burnley" },
  "Chelsea": { footballData: "Chelsea", openfootball: "Chelsea", understat: "Chelsea", fotmob: "Chelsea", mi: "Chelsea" },
  "Crystal Palace": { footballData: "Crystal Palace", openfootball: "Crystal Palace", understat: "Crystal Palace", fotmob: "Crystal Palace", mi: "Crystal Palace" },
  "Everton": { footballData: "Everton", openfootball: "Everton", understat: "Everton", fotmob: "Everton", mi: "Everton" },
  "Fulham": { footballData: "Fulham", openfootball: "Fulham", understat: "Fulham", fotmob: "Fulham", mi: "Fulham" },
  "Ipswich": { footballData: "Ipswich", openfootball: "Ipswich", understat: "Ipswich", fotmob: "Ipswich Town", mi: "Ipswich" },
  "Leeds": { footballData: "Leeds", openfootball: "Leeds", understat: "Leeds", fotmob: "Leeds United", mi: "Leeds" },
  "Leicester": { footballData: "Leicester", openfootball: "Leicester", understat: "Leicester", fotmob: "Leicester City", mi: "Leicester" },
  "Liverpool": { footballData: "Liverpool", openfootball: "Liverpool", understat: "Liverpool", fotmob: "Liverpool", mi: "Liverpool" },
  "Luton": { footballData: "Luton", openfootball: "Luton", understat: "Luton", fotmob: "Luton Town", mi: "Luton" },
  "Manchester City": { footballData: "Manchester City", openfootball: "Manchester City", understat: "Manchester City", fotmob: "Manchester City", mi: "Man City" },
  "Manchester United": { footballData: "Manchester United", openfootball: "Manchester United", understat: "Manchester United", fotmob: "Manchester United", mi: "Man United" },
  "Newcastle United": { footballData: "Newcastle United", openfootball: "Newcastle United", understat: "Newcastle United", fotmob: "Newcastle United", mi: "Newcastle" },
  "Nottingham Forest": { footballData: "Nottingham Forest", openfootball: "Nottingham Forest", understat: "Nottingham Forest", fotmob: "Nottingham Forest", mi: "Nott'ham Forest" },
  "Sheffield United": { footballData: "Sheffield United", openfootball: "Sheffield United", understat: "Sheffield United", fotmob: "Sheffield United", mi: "Sheffield United" },
  "Southampton": { footballData: "Southampton", openfootball: "Southampton", understat: "Southampton", fotmob: "Southampton", mi: "Southampton" },
  "Tottenham": { footballData: "Tottenham", openfootball: "Tottenham", understat: "Tottenham", fotmob: "Tottenham", mi: "Tottenham" },
  "West Ham": { footballData: "West Ham", openfootball: "West Ham", understat: "West Ham", fotmob: "West Ham United", mi: "West Ham" },
  "Wolverhampton Wanderers": { footballData: "Wolverhampton Wanderers", openfootball: "Wolverhampton Wanderers", understat: "Wolverhampton Wanderers", fotmob: "Wolverhampton", mi: "Wolverhampton" },
  // ─── Championship teams ──────────────────────────────────────────────────
  "Birmingham": { footballData: "Birmingham", openfootball: "Birmingham", understat: "Birmingham", fotmob: "Birmingham City", mi: "Birmingham" },
  "Blackburn": { footballData: "Blackburn", openfootball: "Blackburn", understat: "Blackburn", fotmob: "Blackburn Rovers", mi: "Blackburn" },
  "Bristol City": { footballData: "Bristol City", openfootball: "Bristol City", understat: "Bristol City", fotmob: "Bristol City", mi: "Bristol City" },
  "Cardiff": { footballData: "Cardiff", openfootball: "Cardiff", understat: "Cardiff", fotmob: "Cardiff City", mi: "Cardiff" },
  "Coventry": { footballData: "Coventry", openfootball: "Coventry", understat: "Coventry", fotmob: "Coventry City", mi: "Coventry" },
  "Derby": { footballData: "Derby", openfootball: "Derby", understat: "Derby", fotmob: "Derby County", mi: "Derby" },
  "Huddersfield": { footballData: "Huddersfield", openfootball: "Huddersfield", understat: "Huddersfield", fotmob: "Huddersfield Town", mi: "Huddersfield" },
  "Hull City": { footballData: "Hull City", openfootball: "Hull City", understat: "Hull City", fotmob: "Hull City", mi: "Hull City" },
  "Middlesbrough": { footballData: "Middlesbrough", openfootball: "Middlesbrough", understat: "Middlesbrough", fotmob: "Middlesbrough", mi: "Middlesbrough" },
  "Millwall": { footballData: "Millwall", openfootball: "Millwall", understat: "Millwall", fotmob: "Millwall", mi: "Millwall" },
  "Norwich": { footballData: "Norwich", openfootball: "Norwich", understat: "Norwich", fotmob: "Norwich City", mi: "Norwich" },
  "Oxford United": { footballData: "Oxford United", openfootball: "Oxford United", understat: "Oxford United", fotmob: "Oxford United", mi: "Oxford United" },
  "Plymouth": { footballData: "Plymouth", openfootball: "Plymouth", understat: "Plymouth", fotmob: "Plymouth Argyle", mi: "Plymouth" },
  "Portsmouth": { footballData: "Portsmouth", openfootball: "Portsmouth", understat: "Portsmouth", fotmob: "Portsmouth", mi: "Portsmouth" },
  "Preston": { footballData: "Preston", openfootball: "Preston", understat: "Preston", fotmob: "Preston North End", mi: "Preston" },
  "QPR": { footballData: "QPR", openfootball: "QPR", understat: "QPR", fotmob: "QPR", mi: "QPR" },
  "Rotherham": { footballData: "Rotherham", openfootball: "Rotherham", understat: "Rotherham", fotmob: "Rotherham United", mi: "Rotherham" },
  "Sheffield Wednesday": { footballData: "Sheffield Wednesday", openfootball: "Sheffield Wednesday", understat: "Sheffield Wednesday", fotmob: "Sheffield Wednesday", mi: "Sheffield Weds" },
  "Stoke": { footballData: "Stoke", openfootball: "Stoke", understat: "Stoke", fotmob: "Stoke City", mi: "Stoke" },
  "Sunderland": { footballData: "Sunderland", openfootball: "Sunderland", understat: "Sunderland", fotmob: "Sunderland", mi: "Sunderland" },
  "Swansea": { footballData: "Swansea", openfootball: "Swansea", understat: "Swansea", fotmob: "Swansea City", mi: "Swansea" },
  "Watford": { footballData: "Watford", openfootball: "Watford", understat: "Watford", fotmob: "Watford", mi: "Watford" },
  "West Brom": { footballData: "West Brom", openfootball: "West Brom", understat: "West Brom", fotmob: "West Bromwich Albion", mi: "West Brom" },
  // ─── La Liga teams ──────────────────────────────────────────────────────
  "Real Madrid": { footballData: "Real Madrid", openfootball: "Real Madrid", understat: "Real Madrid", fotmob: "Real Madrid", mi: "Real Madrid" },
  "Barcelona": { footballData: "Barcelona", openfootball: "Barcelona", understat: "Barcelona", fotmob: "Barcelona", mi: "Barcelona" },
  "Atletico Madrid": { footballData: "Atletico Madrid", openfootball: "Atletico Madrid", understat: "Atletico Madrid", fotmob: "Atletico Madrid", mi: "Ath Madrid" },
  "Athletic Bilbao": { footballData: "Athletic Bilbao", openfootball: "Athletic Bilbao", understat: "Athletic Club", fotmob: "Athletic Club", mi: "Ath Bilbao" },
  "Real Betis": { footballData: "Real Betis", openfootball: "Real Betis", understat: "Real Betis", fotmob: "Real Betis", mi: "Betis" },
  "Real Sociedad": { footballData: "Real Sociedad", openfootball: "Real Sociedad", understat: "Real Sociedad", fotmob: "Real Sociedad", mi: "Sociedad" },
  "Villarreal": { footballData: "Villarreal", openfootball: "Villarreal", understat: "Villarreal", fotmob: "Villarreal", mi: "Villarreal" },
  "Mallorca": { footballData: "Mallorca", openfootball: "Mallorca", understat: "Mallorca", fotmob: "Mallorca", mi: "Mallorca" },
  "Celta Vigo": { footballData: "Celta Vigo", openfootball: "Celta Vigo", understat: "Celta Vigo", fotmob: "Celta Vigo", mi: "Celta" },
  "Osasuna": { footballData: "Osasuna", openfootball: "Osasuna", understat: "Osasuna", fotmob: "Osasuna", mi: "Osasuna" },
  "Sevilla": { footballData: "Sevilla", openfootball: "Sevilla", understat: "Sevilla", fotmob: "Sevilla", mi: "Sevilla" },
  "Getafe": { footballData: "Getafe", openfootball: "Getafe", understat: "Getafe", fotmob: "Getafe", mi: "Getafe" },
  "Rayo Vallecano": { footballData: "Rayo Vallecano", openfootball: "Rayo Vallecano", understat: "Rayo Vallecano", fotmob: "Rayo Vallecano", mi: "Vallecano" },
  "Deportivo Alaves": { footballData: "Deportivo Alaves", openfootball: "Deportivo Alaves", understat: "Alaves", fotmob: "Alaves", mi: "Alaves" },
  "Leganes": { footballData: "Leganes", openfootball: "Leganes", understat: "Leganes", fotmob: "Leganes", mi: "Leganes" },
  "Las Palmas": { footballData: "Las Palmas", openfootball: "Las Palmas", understat: "Las Palmas", fotmob: "Las Palmas", mi: "Las Palmas" },
  "Girona": { footballData: "Girona", openfootball: "Girona", understat: "Girona", fotmob: "Girona", mi: "Girona" },
  "Valencia": { footballData: "Valencia", openfootball: "Valencia", understat: "Valencia", fotmob: "Valencia", mi: "Valencia" },
  "Valladolid": { footballData: "Valladolid", openfootball: "Valladolid", understat: "Valladolid", fotmob: "Real Valladolid", mi: "Valladolid" },
  "Espanyol": { footballData: "Espanyol", openfootball: "Espanyol", understat: "Espanyol", fotmob: "Espanyol", mi: "Espanyol" },
  // ─── Bundesliga teams ───────────────────────────────────────────────────
  "Bayern Munich": { footballData: "Bayern Munich", openfootball: "Bayern Munich", understat: "Bayern Munich", fotmob: "Bayern Munich", mi: "Bayern Munich" },
  "Borussia Dortmund": { footballData: "Borussia Dortmund", openfootball: "Borussia Dortmund", understat: "Borussia Dortmund", fotmob: "Borussia Dortmund", mi: "Dortmund" },
  "Bayer Leverkusen": { footballData: "Bayer Leverkusen", openfootball: "Bayer Leverkusen", understat: "Bayer Leverkusen", fotmob: "Bayer Leverkusen", mi: "Leverkusen" },
  "RB Leipzig": { footballData: "RB Leipzig", openfootball: "RB Leipzig", understat: "RB Leipzig", fotmob: "RB Leipzig", mi: "RB Leipzig" },
  "Eintracht Frankfurt": { footballData: "Eintracht Frankfurt", openfootball: "Eintracht Frankfurt", understat: "Eintracht Frankfurt", fotmob: "Eintracht Frankfurt", mi: "Ein Frankfurt" },
  "VfB Stuttgart": { footballData: "VfB Stuttgart", openfootball: "VfB Stuttgart", understat: "Stuttgart", fotmob: "VfB Stuttgart", mi: "Stuttgart" },
  "SC Freiburg": { footballData: "SC Freiburg", openfootball: "SC Freiburg", understat: "Freiburg", fotmob: "Freiburg", mi: "Freiburg" },
  "VfL Wolfsburg": { footballData: "VfL Wolfsburg", openfootball: "VfL Wolfsburg", understat: "Wolfsburg", fotmob: "Wolfsburg", mi: "Wolfsburg" },
  "Borussia Monchengladbach": { footballData: "Borussia Monchengladbach", openfootball: "Borussia Monchengladbach", understat: "Borussia M.Gladbach", fotmob: "Borussia Monchengladbach", mi: "M'gladbach" },
  "Mainz": { footballData: "Mainz", openfootball: "Mainz", understat: "Mainz 05", fotmob: "Mainz 05", mi: "Mainz" },
  "FC Augsburg": { footballData: "FC Augsburg", openfootball: "FC Augsburg", understat: "Augsburg", fotmob: "Augsburg", mi: "Augsburg" },
  "TSG Hoffenheim": { footballData: "TSG Hoffenheim", openfootball: "TSG Hoffenheim", understat: "Hoffenheim", fotmob: "Hoffenheim", mi: "Hoffenheim" },
  "Union Berlin": { footballData: "Union Berlin", openfootball: "Union Berlin", understat: "Union Berlin", fotmob: "Union Berlin", mi: "Union Berlin" },
  "FC St. Pauli": { footballData: "FC St. Pauli", openfootball: "FC St. Pauli", understat: "St. Pauli", fotmob: "St. Pauli", mi: "St Pauli" },
  "Heidenheim": { footballData: "Heidenheim", openfootball: "Heidenheim", understat: "Heidenheim", fotmob: "Heidenheim", mi: "Heidenheim" },
  "VfL Bochum": { footballData: "VfL Bochum", openfootball: "VfL Bochum", understat: "Bochum", fotmob: "Bochum", mi: "Bochum" },
  "Holstein Kiel": { footballData: "Holstein Kiel", openfootball: "Holstein Kiel", understat: "Holstein Kiel", fotmob: "Holstein Kiel", mi: "Holstein Kiel" },
  "Werder Bremen": { footballData: "Werder Bremen", openfootball: "Werder Bremen", understat: "Werder Bremen", fotmob: "Werder Bremen", mi: "Werder Bremen" },
};

// Build reverse lookup maps
const footballDataToCanonical = new Map<string, string>();
const openfootballToCanonical = new Map<string, string>();
const understatToCanonical = new Map<string, string>();
const fotmobToCanonical = new Map<string, string>();
const miToCanonical = new Map<string, string>();

for (const [canonical, sources] of Object.entries(TEAM_MAP)) {
  footballDataToCanonical.set(sources.footballData, canonical);
  openfootballToCanonical.set(sources.openfootball, canonical);
  understatToCanonical.set(sources.understat, canonical);
  fotmobToCanonical.set(sources.fotmob, canonical);
  miToCanonical.set(sources.mi, canonical);
}

export function normalizeTeamName(name: string, source: "footballData" | "openfootball" | "understat" | "fotmob" | "mi"): string {
  const map = source === "footballData" ? footballDataToCanonical
    : source === "openfootball" ? openfootballToCanonical
    : source === "fotmob" ? fotmobToCanonical
    : source === "mi" ? miToCanonical
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
