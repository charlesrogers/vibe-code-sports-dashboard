#!/usr/bin/env python3
"""
Parse Ted's Variance Betting newsletter HTML files to extract all bets.

Reads beehiiv HTML files, extracts content from __remixContext JSON,
parses bet lines, and outputs structured JSON.
"""

import os
import re
import json
import sys
from html.parser import HTMLParser
from collections import defaultdict
from datetime import datetime

INPUT_DIR = "/Users/charlesrogers/Documents/variance_betting"
OUTPUT_FILE = "/Users/charlesrogers/Documents/vibe-code-workshop/sports-dashboard/data/ted-bets/all-bets.json"


class TextExtractor(HTMLParser):
    """Extract visible text segments from HTML, skipping style/script tags.

    Note: <link> is a void element (no closing tag), so we must NOT track it
    in skip_tags or the depth counter will never decrement.
    """
    def __init__(self):
        super().__init__()
        self.texts = []
        self.skip_tags = set()

    def handle_starttag(self, tag, attrs):
        if tag in ('style', 'script'):
            self.skip_tags.add(tag)

    def handle_endtag(self, tag):
        self.skip_tags.discard(tag)

    def handle_data(self, data):
        if not self.skip_tags:
            t = data.strip()
            if t:
                self.texts.append(t)


def extract_remix_context(html_content):
    """Find and parse __remixContext JSON from HTML."""
    marker = "window.__remixContext = "
    idx = html_content.find(marker)
    if idx == -1:
        return None

    start = idx + len(marker)
    depth = 0
    for i, c in enumerate(html_content[start:], start):
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        if depth == 0:
            end = i + 1
            break
    else:
        return None

    try:
        return json.loads(html_content[start:end])
    except json.JSONDecodeError:
        return None


def extract_date_published(html_content):
    """Extract datePublished from JSON-LD script tag."""
    match = re.search(r'"datePublished"\s*:\s*"([^"]+)"', html_content)
    if match:
        raw = match.group(1)
        # Parse ISO date, return just the date portion
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            return raw[:10]
    return None


def extract_content_texts(remix_data):
    """Get the post HTML from remixContext and extract text segments."""
    try:
        content_html = remix_data['state']['loaderData']['routes/p/$slug']['html']
    except (KeyError, TypeError):
        return None

    parser = TextExtractor()
    parser.feed(content_html)
    return parser.texts


# League name normalization
LEAGUE_PATTERNS = {
    # EPL / Premier League
    r'(?:^|\b)(?:PREMIER\s+LEAGUE|EPL|English\s+Premier\s+League)\b': 'EPL',
    # Championship
    r'(?:^|\b)(?:CHAMPIONSHIP|English\s+Championship|Eng(?:lish)?\s+Champ(?:ionship)?)\b': 'Championship',
    # Champions League
    r'(?:^|\b)(?:Champions\s+League|UCL|UEFA\s+CL|UEFA\s+Champions\s+League)\b': 'UCL',
    # MLS
    r'(?:^|\b)MLS\b': 'MLS',
    # Club World Cup
    r'(?:^|\b)Club\s+World\s+Cup\b': 'Club World Cup',
    # Europa League
    r'(?:^|\b)(?:Europa\s+League|UEL)\b': 'Europa League',
    # La Liga
    r'(?:^|\b)La\s+Liga\b': 'La Liga',
    # Serie A
    r'(?:^|\b)Serie\s+A\b': 'Serie A',
    # Bundesliga
    r'(?:^|\b)Bundesliga\b': 'Bundesliga',
    # League One
    r'(?:^|\b)League\s+One\b': 'League One',
    # Conference League
    r'(?:^|\b)(?:Conference\s+League|UECL)\b': 'Conference League',
}

# Day headers that separate sections (but don't change league)
DAY_PATTERN = re.compile(
    r'^(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)$',
    re.IGNORECASE
)

# Known EPL teams (for league inference when no header present)
EPL_TEAMS = {
    'arsenal', 'aston villa', 'bournemouth', 'brentford', 'brighton',
    'chelsea', 'crystal palace', 'everton', 'fulham', 'ipswich',
    'leicester', 'leicester city', 'liverpool', 'manchester city', 'man city',
    'manchester united', 'man united', 'newcastle', 'nottingham forest', 'forest',
    'southampton', 'tottenham', 'spurs', 'west ham', 'wolves', 'wolverhampton',
    'burnley', 'luton', 'sheffield united', 'sheff united',
    'united',  # contextual shorthand for Man United in EPL context
}

# Known Championship teams (for league inference)
CHAMPIONSHIP_TEAMS = {
    'blackburn', 'blackburn rovers', 'birmingham', 'bristol city', 'bristol',
    'cardiff', 'coventry', 'derby', 'hull', 'hull city', 'leeds', 'leeds united',
    'luton', 'luton town', 'middlesbrough', 'boro', 'millwall', 'norwich',
    'oxford', 'oxford united', 'plymouth', 'portsmouth', 'pompey',
    'preston', 'preston north end', 'pne', 'qpr', 'queens park rangers',
    'sheffield wednesday', 'sheff weds', 'sheffield united', 'sheff united',
    'stoke', 'stoke city', 'sunderland', 'swansea', 'watford',
    'west brom', 'west bromwich albion', 'wba', 'wrexham', 'charlton',
}


def guess_league_from_teams(team1, team2):
    """Guess the league from team names."""
    t1 = team1.lower().strip()
    t2 = team2.lower().strip()
    epl_count = (t1 in EPL_TEAMS) + (t2 in EPL_TEAMS)
    champ_count = (t1 in CHAMPIONSHIP_TEAMS) + (t2 in CHAMPIONSHIP_TEAMS)
    if epl_count > champ_count:
        return 'EPL'
    if champ_count > epl_count:
        return 'Championship'
    if epl_count > 0:
        return 'EPL'
    if champ_count > 0:
        return 'Championship'
    return None

# Separator pattern for "v", "v.", "vs", "vs."
# Note: \b fails after a period, so we match the separator followed by whitespace
VS_PAT = r'(?:vs\.\s|vs\s|v\.\s|v\s)'

# Match line patterns - team v/vs team with line and odds
# e.g. "Leicester v Arsenal +1.5 1.99/1.92 OR +1.5 -101/-109"
# e.g. "AC Milan vs. Club Brugge -1.25 -102"
# e.g. "DC United vs. Nashville SC: +0.5, 1.95/1.95"
MATCH_LINE_RE = re.compile(
    r'^(.+?)\s+' + VS_PAT + r'(.+?)\s+([+-]?\d*\.?\d+)\s',
    re.IGNORECASE
)

# Alternative: match with "Pick'Em" or "pk"
MATCH_PICKEM_RE = re.compile(
    r'^(.+?)\s+' + VS_PAT + r'(.+?)\s+(?:Pick|pk|PK)',
    re.IGNORECASE
)

# Match line with just teams and line (no odds on same line)
MATCH_SIMPLE_RE = re.compile(
    r'^(.+?)\s+' + VS_PAT + r'(.+?)[\s:]+([+-]?\d*\.?\d+)\s*$',
    re.IGNORECASE
)

# Match with 0 line and comma (e.g. "SKC vs RSL: 0, 1.83/2.07")
MATCH_ZERO_RE = re.compile(
    r'^(.+?)\s+' + VS_PAT + r'(.+?)[\s:]+0\s*[,\s]',
    re.IGNORECASE
)

# Match with MLS colon format (e.g. "DC United vs. Nashville SC: +0.5, 1.95/1.95")
MATCH_COLON_RE = re.compile(
    r'^(.+?)\s+' + VS_PAT + r'(.+?):\s*([+-]?\d*\.?\d+)',
    re.IGNORECASE
)

# Match with no line at all (just two teams, e.g. "Middlesbrough vs. Sheffield United")
MATCH_NOLINE_RE = re.compile(
    r'^(.+?)\s+' + VS_PAT + r'(.+?)\s*$',
    re.IGNORECASE
)

# Bet line patterns - handles "Bets:", "Ted's Bets:", "Ted Bets:", "Kim's Bets:", "Ted's Bets::"
BET_LINE_RE = re.compile(
    r"^(?:(?:Ted|Kim).?s?\s+)?Bets?:+\s*(.*)$",
    re.IGNORECASE
)

# "No bet" variants
NO_BET_PATTERNS = [
    r'no\s+bets?',
    r'none',
    r'off\s+limits',
    r'no[.,]?\s*just\s+no',
    r'not\s+today',
    r'haha',
    r'check\s+(?:lineup|social|injury)',
    r'\[check',
    r'lineups',
    r'lean\s+\w+',
    r'dealer.s\s+choice',
    r'uhhh',
    r'no\s+fucking\s+clue',
    r'do\s+not\s+touch',
    r'we\s+are\s+not\s+betting',
    r'wait(?:ing)?\s+(?:for|on)',
    r'\[maybe',
    r'\[i\s+(?:am\s+not|do\s+not)',
    r'food\s+poisoning',
    r'should\s+be\s+a\s+\w+\s+bet\s*(?:,\s*)?but',
    r'this\s+(?:should|would|was)\s+(?:be|have\s+been)',
    r'vetoed',
    r'no\s+guidance',
    r'suspended\s+from\s+betting',
    r'off\s+limits',
    r'weds\s+games\s+are\s+off',
    r'awkwardly\s+tempted',
    r'strong\s+lean',
    r'check\s+(?:back|for)',
    r'prob\s+no\s+bet',
    r'probably\s+no',
    r'\[no\s+guidance',
    r'i\s+want\s+to\s+for\s+posterity',
    r'but\s+close\s+to',
    r'on\s+the\s+fence',
]

NO_BET_RE = re.compile('|'.join(NO_BET_PATTERNS), re.IGNORECASE)


def detect_league(text):
    """Check if a text line is a league header. Returns normalized name or None."""
    for pattern, name in LEAGUE_PATTERNS.items():
        if re.search(pattern, text, re.IGNORECASE):
            # Make sure it's a header-like line (short, or starts with the league name)
            # Avoid matching league names inside long prose
            if len(text) < 80:
                return name
    return None


def is_match_line(text):
    """Check if text looks like a match line (Team v Team ...). Returns (team1, team2, line_str) or None."""
    # Clean non-breaking spaces
    text = text.replace('\xa0', ' ').strip()

    # Must contain 'v' or 'vs' separator with spaces around it
    if not re.search(r'\s+(?:vs?\.|vs?)\s+', text, re.IGNORECASE):
        return None

    # Skip lines that are clearly not match lines (too long prose, etc.)
    if len(text) > 200:
        return None

    # Try pickem first
    m = MATCH_PICKEM_RE.match(text)
    if m:
        return (m.group(1).strip(), m.group(2).strip(), "0")

    # Try standard match with line + odds
    m = MATCH_LINE_RE.match(text)
    if m:
        return (m.group(1).strip(), m.group(2).strip(), m.group(3).strip())

    # Try MLS colon format
    m = MATCH_COLON_RE.match(text)
    if m:
        return (m.group(1).strip(), m.group(2).strip(), m.group(3).strip())

    # Try simple match (line at end, no odds)
    m = MATCH_SIMPLE_RE.match(text)
    if m:
        return (m.group(1).strip(), m.group(2).strip(), m.group(3).strip())

    # Match with 0 line
    m = MATCH_ZERO_RE.match(text)
    if m:
        return (m.group(1).strip(), m.group(2).strip(), "0")

    # Match with no line (just two teams)
    m = MATCH_NOLINE_RE.match(text)
    if m:
        team2 = m.group(2).strip()
        # Make sure team2 doesn't contain too much junk
        if len(team2) < 50:
            return (m.group(1).strip(), team2, "0")

    return None


def parse_bet_selection(bet_text):
    """
    Parse a bet selection string into (selection, line, bet_type).
    Returns list of tuples for multi-bets (e.g. "Under 2.5, Sheff United").
    """
    bet_text = bet_text.replace('\xa0', ' ').strip()

    # Remove trailing commentary in brackets or after certain patterns
    # e.g. "[This is aggressive.]", "(half bet)", "*wince*"
    bet_text = re.sub(r'\s*[\[\(].*$', '', bet_text)
    bet_text = re.sub(r'\s*\*\w+\*\s*$', '', bet_text)

    # Remove odds at end like "-121", "1.84", "-106", "+109", "-112"
    # But be careful not to remove the line itself
    # Odds are typically at the very end after the line
    bet_text = bet_text.strip()

    results = []

    # Split on comma for multi-bets (e.g. "Under 2.5, Sheff United")
    # But be careful: "Cardiff -.25 - Only 300 size instead of 500."
    bet_text = re.sub(r'\s*-\s*Only\s.*$', '', bet_text, flags=re.IGNORECASE)
    bet_text = re.sub(r'\s*HALF\s+SIZE\s*$', '', bet_text, flags=re.IGNORECASE)
    bet_text = re.sub(r'\s*HALF\s+BET\s*$', '', bet_text, flags=re.IGNORECASE)
    bet_text = re.sub(r'\s*\[HALF\]?\s*$', '', bet_text, flags=re.IGNORECASE)
    bet_text = re.sub(r'\s*Goddammit\s*$', '', bet_text, flags=re.IGNORECASE)
    bet_text = re.sub(r'\s*-\s*$', '', bet_text)

    # Split on ", " for multi-bets but not within team names
    parts = re.split(r',\s+', bet_text)

    for part in parts:
        part = part.strip()
        if not part:
            continue

        parsed = parse_single_bet(part)
        if parsed:
            results.append(parsed)

    return results


def parse_single_bet(text):
    """Parse a single bet like 'Forest +.5' or 'Over 2.75' or 'Arsenal -1'. Returns (selection, line, bet_type) or None."""
    text = text.strip()
    if not text:
        return None

    # Over/Under bets
    m = re.match(r'^((?:OVER|UNDER)\s+[\d.]+)', text, re.IGNORECASE)
    if m:
        ou_text = m.group(1)
        line_m = re.search(r'([\d.]+)', ou_text)
        line = float(line_m.group(1)) if line_m else 0
        return (ou_text.strip(), line, "ou")

    # Team with "pk" / "pk (0)" / "pk -112" etc. - pickem = 0 line
    m = re.match(r'^(.+?)\s+pk\b', text, re.IGNORECASE)
    if m:
        return (m.group(1).strip() + " 0", 0.0, "ah")

    # Team with +/- line, possibly followed by odds
    # The line is a handicap value (typically -5 to +5 range, can have decimals like .25, .5, .75)
    # Odds are American format (3+ digit numbers like -112, +103) or decimal (1.xx/2.xx)
    m = re.match(r'^(.+?)\s+([+-]?\d*\.?\d+)\s*(?:[+-]?\d{3,}|[\d.]+/[\d.]+|[\d.]+\s*$|$)', text)
    if m:
        team = m.group(1).strip()
        line_str = m.group(2)
        try:
            line = float(line_str)
        except ValueError:
            line = 0

        # If the "line" looks like American odds (absolute value >= 100), skip it
        # Real handicap lines are rarely above 10
        if abs(line) >= 100:
            # This is probably just odds, not a real bet parse
            return None

        # If team name has "ML" at end, it's moneyline
        if re.search(r'\bML\b', team, re.IGNORECASE):
            team = re.sub(r'\s*ML\s*$', '', team, flags=re.IGNORECASE).strip()
            return (team + " ML", 0, "ml")

        return (f"{team} {line_str}", line, "ah")

    # Just a team name with 0 (pickem)
    m = re.match(r'^(.+?)\s+0\s*$', text)
    if m:
        return (m.group(1).strip() + " 0", 0.0, "ah")

    # Team ML
    m = re.match(r'^(.+?)\s+ML\s*$', text, re.IGNORECASE)
    if m:
        return (m.group(1).strip() + " ML", 0, "ml")

    # Bare team name (like "West Brom" with no line - treat as needs context)
    # For now skip these

    return None


def infer_league_from_filename(filename):
    """Try to infer the league from the filename when no league header found in content."""
    fn_lower = filename.lower()
    if 'cwc' in fn_lower or 'club world cup' in fn_lower:
        return 'Club World Cup'
    if 'mls' in fn_lower:
        return 'MLS'
    if 'ucl' in fn_lower or 'champions league' in fn_lower or 'uefa cl' in fn_lower:
        return 'UCL'
    if re.search(r'\bcl\b', fn_lower):
        return 'UCL'
    if 'epl' in fn_lower or 'premier league' in fn_lower or 'premier' in fn_lower:
        return 'EPL'
    if 'champ' in fn_lower and 'champions' not in fn_lower:
        return 'Championship'
    # Generic "Variance Betting" weekend files are usually EPL
    return None


def parse_file(filepath, filename):
    """Parse a single HTML file and return list of bet dicts."""
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        html = f.read()

    # Skip non-HTML
    if not html.strip().startswith('<!DOCTYPE') and not html.strip().startswith('<html'):
        return []

    # Extract date
    newsletter_date = extract_date_published(html)

    # Extract remix context
    remix_data = extract_remix_context(html)
    if remix_data is None:
        return []

    texts = extract_content_texts(remix_data)
    if texts is None:
        return []

    # Check if this has any bet lines at all
    has_bets = False
    for t in texts:
        if re.search(r"(?:Ted.s\s+)?Bets?:", t, re.IGNORECASE):
            has_bets = True
            break
    if not has_bets:
        return []

    # Now parse through the texts to find matches and bets
    bets = []
    current_league = infer_league_from_filename(filename)
    current_match = None  # (team1, team2, line_str, full_match_text)

    # First pass: detect if the newsletter title/filename suggests a league context
    # For newsletters with both EPL and Championship, we rely on in-content headers

    for i, text in enumerate(texts):
        text_clean = text.replace('\xa0', ' ').strip()

        # Check for league header
        league = detect_league(text_clean)
        if league:
            current_league = league
            continue

        # Check for day header
        if DAY_PATTERN.match(text_clean):
            continue

        # Check for day+league headers like "Tuesday CL", "Wednesday Champ"
        day_league = re.match(
            r'^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+'
            r'(CL|Champions\s+League|Champ(?:ionship)?|EPL|MLS)\b',
            text_clean, re.IGNORECASE
        )
        if day_league:
            league_part = day_league.group(1).lower()
            if 'cl' in league_part or 'champion' in league_part:
                current_league = 'UCL'
            elif 'champ' in league_part:
                current_league = 'Championship'
            elif 'epl' in league_part:
                current_league = 'EPL'
            elif 'mls' in league_part:
                current_league = 'MLS'
            continue

        # Check for section headers like "Bonus: Club World Cup"
        bonus_league = re.match(r'^Bonus:\s*(.+)', text_clean, re.IGNORECASE)
        if bonus_league:
            bl = bonus_league.group(1).strip()
            detected = detect_league(bl)
            if detected:
                current_league = detected
                continue

        # Check for match line
        match_info = is_match_line(text_clean)
        if match_info:
            team1, team2, line_str = match_info
            current_match = {
                'team1': team1,
                'team2': team2,
                'line_str': line_str,
                'full_text': f"{team1} v {team2}",
            }
            continue

        # Check for bet line
        bet_m = BET_LINE_RE.match(text_clean)
        if bet_m:
            bet_content = bet_m.group(1).strip()

            # Check if it's a no-bet
            if not bet_content or NO_BET_RE.search(bet_content):
                current_match = None
                continue

            # Also skip specific non-bet phrases
            if bet_content.lower().startswith('no ') or bet_content.lower() == 'none':
                current_match = None
                continue

            # Parse the bet selection(s)
            selections = parse_bet_selection(bet_content)

            for sel in selections:
                selection_str, line_val, bet_type = sel

                # Try to infer league from teams if not set
                effective_league = current_league
                if not effective_league and current_match:
                    effective_league = guess_league_from_teams(
                        current_match['team1'], current_match['team2']
                    )

                bet_entry = {
                    'newsletter_date': newsletter_date,
                    'league': effective_league or 'Unknown',
                    'match': current_match['full_text'] if current_match else 'Unknown',
                    'selection': selection_str,
                    'line': line_val,
                    'bet_type': bet_type,
                    'source_file': filename,
                }
                bets.append(bet_entry)

            current_match = None
            continue

    return bets


def main():
    print(f"=" * 70)
    print(f"Parsing Ted's Variance Betting newsletters")
    print(f"Input directory: {INPUT_DIR}")
    print(f"Output file: {OUTPUT_FILE}")
    print(f"=" * 70)

    # Get all files
    all_files = sorted(os.listdir(INPUT_DIR))
    html_files = [f for f in all_files if f.endswith('.html')]
    non_html = [f for f in all_files if not f.endswith('.html')]

    print(f"\nFound {len(all_files)} total files, {len(html_files)} HTML files")
    if non_html:
        print(f"Skipping {len(non_html)} non-HTML files: {', '.join(non_html)}")

    all_bets = []
    files_with_bets = 0
    files_skipped = 0
    files_no_bets = 0

    for idx, fname in enumerate(html_files):
        filepath = os.path.join(INPUT_DIR, fname)
        print(f"\n[{idx+1}/{len(html_files)}] Parsing: {fname}")

        try:
            bets = parse_file(filepath, fname)
            if bets:
                files_with_bets += 1
                all_bets.extend(bets)
                print(f"  -> Found {len(bets)} bets")
                for b in bets:
                    print(f"     {b['league']:15s} | {b['match']:40s} | {b['selection']}")
            else:
                # Check why no bets
                with open(filepath, 'r', errors='replace') as f:
                    content = f.read()
                if 'remixContext' not in content:
                    print(f"  -> SKIPPED (no remixContext)")
                    files_skipped += 1
                elif 'Bets:' not in content and "Bet:" not in content:
                    print(f"  -> SKIPPED (no betting content)")
                    files_skipped += 1
                else:
                    print(f"  -> No actionable bets found (all No Bets/OFF LIMITS)")
                    files_no_bets += 1
        except Exception as e:
            print(f"  -> ERROR: {e}")
            files_skipped += 1

    # Sort by date
    all_bets.sort(key=lambda x: (x.get('newsletter_date') or '', x.get('league', ''), x.get('match', '')))

    # Write output
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(all_bets, f, indent=2)

    print(f"\n{'=' * 70}")
    print(f"SUMMARY")
    print(f"{'=' * 70}")
    print(f"Total HTML files processed: {len(html_files)}")
    print(f"Files with bets: {files_with_bets}")
    print(f"Files with no actionable bets: {files_no_bets}")
    print(f"Files skipped (not betting content): {files_skipped}")
    print(f"Total bets extracted: {len(all_bets)}")

    # Bets per league
    league_counts = defaultdict(int)
    for b in all_bets:
        league_counts[b['league']] += 1

    print(f"\nBets by League:")
    for league, count in sorted(league_counts.items(), key=lambda x: -x[1]):
        print(f"  {league:25s}: {count:4d}")

    # Bets per month
    month_counts = defaultdict(int)
    for b in all_bets:
        if b['newsletter_date']:
            month = b['newsletter_date'][:7]  # YYYY-MM
            month_counts[month] += 1
        else:
            month_counts['Unknown'] += 1

    print(f"\nBets by Month:")
    for month, count in sorted(month_counts.items()):
        print(f"  {month}: {count:4d}")

    # Bet type breakdown
    type_counts = defaultdict(int)
    for b in all_bets:
        type_counts[b['bet_type']] += 1

    print(f"\nBets by Type:")
    for bt, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        label = {'ah': 'Asian Handicap', 'ou': 'Over/Under', 'ml': 'Moneyline'}.get(bt, bt)
        print(f"  {label:25s}: {count:4d}")

    print(f"\nOutput written to: {OUTPUT_FILE}")
    print(f"{'=' * 70}")


if __name__ == '__main__':
    main()
