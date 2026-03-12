/**
 * Derby / Rivalry Detection
 *
 * Derbies produce abnormal results — higher variance, less model-predictable.
 * Display as contextual information on the picks page (no filter, just flagging).
 */

// Derby pairs: [teamA, teamB] — order doesn't matter
const DERBY_PAIRS: Record<string, [string, string][]> = {
  epl: [
    ["Arsenal", "Tottenham"],
    ["Liverpool", "Everton"],
    ["Liverpool", "Manchester Utd"],
    ["Manchester Utd", "Manchester City"],
    ["Manchester Utd", "Leeds"],
    ["Chelsea", "Tottenham"],
    ["Chelsea", "Arsenal"],
    ["Arsenal", "Manchester Utd"],
    ["Newcastle", "Sunderland"],
    ["Aston Villa", "Birmingham"],
    ["Aston Villa", "Wolves"],
    ["West Ham", "Tottenham"],
    ["Crystal Palace", "Brighton"],
    ["Nottingham Forest", "Leicester"],
  ],
  "la-liga": [
    ["Barcelona", "Real Madrid"],
    ["Atletico Madrid", "Real Madrid"],
    ["Barcelona", "Atletico Madrid"],
    ["Barcelona", "Espanyol"],
    ["Sevilla", "Real Betis"],
    ["Athletic Club", "Real Sociedad"],
    ["Valencia", "Villarreal"],
    ["Celta Vigo", "Deportivo La Coruna"],
  ],
  bundesliga: [
    ["Bayern Munich", "Dortmund"],
    ["Dortmund", "Schalke 04"],
    ["Hamburg", "Werder Bremen"],
    ["Koln", "Gladbach"],
    ["Bayern Munich", "1860 Munich"],
    ["Stuttgart", "Karlsruher SC"],
    ["Hertha Berlin", "Union Berlin"],
    ["Frankfurt", "Darmstadt"],
    ["Leverkusen", "Koln"],
  ],
  "serie-a": [
    ["Inter", "AC Milan"],
    ["Juventus", "Inter"],
    ["Juventus", "AC Milan"],
    ["Roma", "Lazio"],
    ["Napoli", "Juventus"],
    ["Napoli", "Roma"],
    ["Fiorentina", "Juventus"],
    ["Genoa", "Sampdoria"],
    ["Torino", "Juventus"],
    ["Atalanta", "Brescia"],
    ["Hellas Verona", "Chievo"],
  ],
  "serie-b": [
    ["Genoa", "Sampdoria"],
    ["Bari", "Lecce"],
    ["Palermo", "Catania"],
  ],
};

/**
 * Normalize team name for fuzzy matching.
 */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Check if a match is a derby. Returns the derby name or null.
 */
export function isDerby(
  homeTeam: string,
  awayTeam: string,
  league?: string,
): boolean {
  const leaguesToCheck = league ? [league] : Object.keys(DERBY_PAIRS);
  const homeNorm = normalize(homeTeam);
  const awayNorm = normalize(awayTeam);

  for (const lid of leaguesToCheck) {
    const pairs = DERBY_PAIRS[lid];
    if (!pairs) continue;
    for (const [a, b] of pairs) {
      const aNorm = normalize(a);
      const bNorm = normalize(b);
      if (
        (homeNorm.includes(aNorm) || aNorm.includes(homeNorm)) &&
        (awayNorm.includes(bNorm) || bNorm.includes(awayNorm))
      ) return true;
      if (
        (homeNorm.includes(bNorm) || bNorm.includes(homeNorm)) &&
        (awayNorm.includes(aNorm) || aNorm.includes(awayNorm))
      ) return true;
    }
  }
  return false;
}

/**
 * Get derby label for display.
 */
export function getDerbyLabel(
  homeTeam: string,
  awayTeam: string,
  league?: string,
): string | null {
  if (!isDerby(homeTeam, awayTeam, league)) return null;
  return "Derby";
}
