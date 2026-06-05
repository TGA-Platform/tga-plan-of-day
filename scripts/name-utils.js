/**
 * name-utils.js — Shared name normalisation for WWCC matching.
 *
 * PROBLEM: Staff names appear differently across Deputy, Monday onboarding
 * board, and individual centre staffing structure boards. Mismatches cause
 * WWCC lookups to fail in the Reg 151 report.
 *
 * KNOWN PATTERNS (learned from production data):
 *   1. Parenthetical content   — "(Cherise) Xue Yang" / "Xue Yang (Cherise)"
 *                                 / "Paris-Renee Stewart (Room Leader)"
 *   2. Hyphen/apostrophe diffs — "Al-Maarrawie" vs "Almaarrawie"
 *   3. Role abbreviations      — "Charlotte Simmons RL", "John Smith EL"
 *   4. Verbose role suffixes   — "- Room Leader", "- Educational Leader"
 *   5. Copy/duplicate markers  — "(copy)", "- contracted role"
 *   6. Different first names   — "Caitlin" vs "Catey" (same person, different
 *                                 preferred name) → handled by fallback matching
 *   7. Deputy bracket format   — "(Cherise) Xue Yang" with brackets BEFORE name
 *
 * STRATEGY:
 *   Apply normaliseForMatching() to BOTH the stored name (sync side) AND the
 *   query name (lookup side). When both sides normalise the same way, names
 *   match regardless of the original formatting noise.
 *
 *   Then use multi-strategy fallback for remaining mismatches:
 *     1. Exact normalised match
 *     2. Bare match (also strip hyphens + spaces)
 *     3. Unique last-name match
 *     4. First-initial + last-name match (when multiple share a surname)
 *     5. Levenshtein distance ≤ 2 on normalised name (catches typos/minor diffs)
 */

/**
 * Aggressively normalise a staff name for matching.
 * Apply this to names on BOTH the storage side (sync scripts) and
 * the lookup side (report frontend) so they always compare apples-to-apples.
 */
export function normaliseForMatching(name) {
  return name
    // 1. Strip anything in brackets — role titles, preferred names, copy markers
    .replace(/\s*[\(\[{][^\)\]{}]*[\)\]{}]\s*/g, ' ')
    // 2. Strip "- <role descriptor>" patterns (e.g. "- Room Leader", "- Maternity Leave")
    .replace(/\s+-\s+.+$/i, '')
    // 3. Strip trailing standalone role abbreviations
    .replace(/\s+\b(RL|EL|CD|AD|ECT|2IC|HOD|HOE|RN|DON)\b\s*$/i, '')
    // 4. Strip trailing verbose role words (without a leading dash)
    .replace(/\s+(Room Leader|Educational Leader|Centre Director|Assistant Director|Early Childhood Teacher|Co-ordinator|Coordinator|Director)\s*$/i, '')
    // 5. Strip copy/status markers that sometimes appear in name fields
    .replace(/\s*[-–]\s*(copy|contracted role|replacement|mat leave|maternity leave|on hold|archived)\s*.*$/i, '')
    // 6. Strip hyphens and apostrophes (catches Al-Maarrawie vs Almaarrawie)
    .replace(/[-'`'']/g, '')
    // 7. Collapse whitespace, trim, lowercase
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Simple Levenshtein distance — used as a last-resort fuzzy fallback.
 * Returns the edit distance between two strings.
 */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
