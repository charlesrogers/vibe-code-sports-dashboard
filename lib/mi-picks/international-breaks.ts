/**
 * International Break Detection
 *
 * Post-international-break matchdays are notoriously unpredictable:
 * players return fatigued, team cohesion is disrupted. Ted would PASS
 * or reduce sizing on the first matchday back.
 *
 * Dates: FIFA international windows 2022-2025 (end dates).
 * The first league matchday after the break end is flagged.
 */

// End dates of FIFA international windows (last match day of the break).
// First league match AFTER this date is considered "post-break".
const INTERNATIONAL_BREAK_END_DATES: string[] = [
  // 2022
  "2022-03-29",  // March window
  "2022-06-14",  // June window (Nations League / qualifiers)
  "2022-09-27",  // September window
  "2022-11-20",  // World Cup starts (leagues pause until late Dec)
  "2022-12-18",  // World Cup final — leagues resume after this

  // 2023
  "2023-03-28",  // March window
  "2023-06-20",  // June window
  "2023-09-12",  // September window
  "2023-10-17",  // October window
  "2023-11-21",  // November window

  // 2024
  "2024-03-26",  // March window
  "2024-06-14",  // Euros / Copa start (leagues done by then mostly)
  "2024-07-14",  // Euro 2024 final — pre-season after this
  "2024-09-10",  // September window
  "2024-10-15",  // October window
  "2024-11-19",  // November window

  // 2025
  "2025-03-25",  // March window
  "2025-06-10",  // June window
  "2025-09-09",  // September window
  "2025-10-14",  // October window
  "2025-11-18",  // November window
];

// Number of days after break end to consider as "post-break matchday"
const POST_BREAK_WINDOW_DAYS = 5;

/**
 * Returns true if matchDate falls within the first matchday window
 * after an international break ends.
 */
export function isPostInternationalBreak(matchDate: string): boolean {
  const matchTime = new Date(matchDate).getTime();

  for (const endDate of INTERNATIONAL_BREAK_END_DATES) {
    const breakEnd = new Date(endDate).getTime();
    const daysSinceBreak = (matchTime - breakEnd) / 86400000;

    // Match is within the post-break window (1-5 days after break ends)
    if (daysSinceBreak > 0 && daysSinceBreak <= POST_BREAK_WINDOW_DAYS) {
      return true;
    }
  }
  return false;
}

/**
 * Get the break end date that a match falls after, if any.
 */
export function getBreakEndDate(matchDate: string): string | null {
  const matchTime = new Date(matchDate).getTime();

  for (const endDate of INTERNATIONAL_BREAK_END_DATES) {
    const breakEnd = new Date(endDate).getTime();
    const daysSinceBreak = (matchTime - breakEnd) / 86400000;
    if (daysSinceBreak > 0 && daysSinceBreak <= POST_BREAK_WINDOW_DAYS) {
      return endDate;
    }
  }
  return null;
}
