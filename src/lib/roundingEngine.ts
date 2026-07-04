/**
 * Timesheet rounding engine.
 *
 * Rules:
 * - Actual start/end within ±15 min of rostered → rounds to rostered time.
 * - Beyond ±15 min → keeps actual and raises a flag.
 * - Lunch duration within ±15 min of rostered duration → rounds to rostered.
 * - Beyond ±15 min → keeps actual duration and raises a flag.
 *
 * Example: rostered 07:00–15:00, lunch 30 min;
 * actual 06:56 in, 11:03–11:45 lunch, 15:06 out
 * → approved 07:00–15:00, 30 min lunch = 7.5 hours
 */

export interface RosteredTimes {
  start: string; // HH:MM
  end: string; // HH:MM
  lunchDuration: number; // minutes
}

export interface ActualTimes {
  start?: string; // HH:MM
  end?: string; // HH:MM
  lunchStart?: string; // HH:MM
  lunchEnd?: string; // HH:MM
}

export interface RoundingResult {
  approvedStart: string; // HH:MM
  approvedEnd: string; // HH:MM
  approvedLunchDuration: number; // minutes
  approvedHours: number;
  flags: string[];
}

const TOLERANCE_MINUTES = 15;

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHhmm(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.max(0, mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function roundTimesheet(
  rostered: RosteredTimes,
  actual: ActualTimes
): RoundingResult {
  const flags: string[] = [];

  const rosterStartM = hhmmToMinutes(rostered.start);
  const rosterEndM = hhmmToMinutes(rostered.end);
  const rosterLunchM = rostered.lunchDuration || 0;

  // Start time
  let approvedStartM = rosterStartM;
  if (actual.start) {
    const actualStartM = hhmmToMinutes(actual.start);
    const diff = actualStartM - rosterStartM;
    if (Math.abs(diff) > TOLERANCE_MINUTES) {
      approvedStartM = actualStartM;
      flags.push(`Start ${Math.abs(diff)} min ${diff > 0 ? 'late' : 'early'} (${actual.start} vs ${rostered.start})`);
    }
  } else {
    flags.push('Missing start time');
  }

  // End time
  let approvedEndM = rosterEndM;
  if (actual.end) {
    const actualEndM = hhmmToMinutes(actual.end);
    const diff = actualEndM - rosterEndM;
    if (Math.abs(diff) > TOLERANCE_MINUTES) {
      approvedEndM = actualEndM;
      flags.push(`End ${Math.abs(diff)} min ${diff > 0 ? 'late' : 'early'} (${actual.end} vs ${rostered.end})`);
    }
  } else {
    flags.push('Missing end time');
  }

  // Lunch duration
  let approvedLunchM = rosterLunchM;
  if (actual.lunchStart && actual.lunchEnd) {
    const actualLunchM = hhmmToMinutes(actual.lunchEnd) - hhmmToMinutes(actual.lunchStart);
    const diff = actualLunchM - rosterLunchM;
    if (Math.abs(diff) > TOLERANCE_MINUTES) {
      approvedLunchM = actualLunchM;
      flags.push(`Lunch ${actualLunchM} min vs rostered ${rosterLunchM} min`);
    }
  } else if (rosterLunchM > 0) {
    flags.push('Missing lunch times');
  }

  // Ensure approved end is after approved start
  if (approvedEndM <= approvedStartM) {
    flags.push('End time must be after start time');
  }

  const approvedHours = Math.max(0, (approvedEndM - approvedStartM - approvedLunchM) / 60);

  return {
    approvedStart: minutesToHhmm(approvedStartM),
    approvedEnd: minutesToHhmm(approvedEndM),
    approvedLunchDuration: approvedLunchM,
    approvedHours,
    flags,
  };
}

/** Build a display string of hours to 2 decimals, e.g. 7.50 */
export function formatHours(hours: number): string {
  return hours.toFixed(2);
}
