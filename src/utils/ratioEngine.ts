import type { AttendanceChild, Room, RoomRatioStatus, RosteredStaff } from '../types';

// NSW ratios: age in months → max children per educator
export const AGE_BRACKETS = [
  { label: '0–2 yrs',  minMonths: 0,   maxMonths: 24,  ratio: 4  },
  { label: '2–3 yrs',  minMonths: 24,  maxMonths: 36,  ratio: 5  },
  { label: '3–6 yrs',  minMonths: 36,  maxMonths: 999, ratio: 10 },
];

export function parseAgeMonths(ageStr: string | null): number {
  if (!ageStr) return -1;
  // Format: "2y 3m" or "11m" or "1y"
  const yearMatch  = ageStr.match(/(\d+)y/);
  const monthMatch = ageStr.match(/(\d+)m/);
  const years  = yearMatch  ? parseInt(yearMatch[1])  : 0;
  const months = monthMatch ? parseInt(monthMatch[1]) : 0;
  return years * 12 + months;
}

/**
 * Cascade ratio algorithm (NSW):
 * Work youngest-first. Unused capacity (remaining slots) from each group
 * carries over as raw slots to the next group — NOT a fresh full-ratio re-allocation.
 *
 * Example: 8 toddlers (1:5) + 8 preschoolers (1:10)
 *   2 staff for 8 toddlers → 2×5=10 capacity, 2 unused slots carry over
 *   8 preschoolers − 2 covered = 6 remaining → ceil(6/10) = 1 more staff → total 3
 *
 * Example: 3 babies (1:4) + 6 toddlers (1:5)
 *   1 staff for 3 babies → 1×4=4 capacity, 1 unused slot carries over
 *   6 toddlers − 1 covered = 5 remaining → ceil(5/5) = 1 more staff → total 2
 */
export function calcRequiredStaff(children: AttendanceChild[]): {
  required: number;
  breakdown: { bracket: string; count: number; ratio: number; staffAllocated: number }[];
} {
  const groups = AGE_BRACKETS.map(b => ({
    ...b,
    count: children.filter(c => c.ageMonths >= b.minMonths && c.ageMonths < b.maxMonths && c.ageMonths >= 0).length,
    staffAllocated: 0,
  }));

  let totalStaff = 0;
  let carryover = 0; // unused capacity slots from previous group

  for (const group of groups) {
    if (group.count === 0) continue;

    const coveredByCarryover = Math.min(group.count, carryover);
    const stillNeeded        = group.count - coveredByCarryover;
    const newStaff           = Math.ceil(stillNeeded / group.ratio);

    group.staffAllocated = newStaff;
    totalStaff += newStaff;

    // Carry forward: unused slots from new staff + leftover carryover
    const unusedFromNew      = newStaff * group.ratio - stillNeeded;
    const unusedFromCarryover = carryover - coveredByCarryover;
    carryover = unusedFromNew + unusedFromCarryover;
  }

  return {
    required: totalStaff,
    breakdown: groups.filter(g => g.count > 0).map(g => ({ bracket: g.label, count: g.count, ratio: g.ratio, staffAllocated: g.staffAllocated })),
  };
}

// Convert a Deputy time value (Unix timestamp or HH:MM string) to minutes since midnight
function toShiftMins(t: string | number | null | undefined): number | null {
  if (!t) return null;
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    // Unix timestamp in seconds
    const d = new Date(num * 1000);
    const h = d.toLocaleString('en-AU', { hour: '2-digit', hour12: false, timeZone: 'Australia/Sydney' });
    const m = d.getMinutes();
    return parseInt(h) * 60 + m;
  }
  // HH:MM string
  const parts = String(t).split(':').map(Number);
  if (parts.length >= 2 && !isNaN(parts[0])) return parts[0] * 60 + (parts[1] || 0);
  return null;
}

/** Check whether a child's room string matches a configured room, using ownaRoomName,
 *  display name, and any historical aliases. Matches in either direction so both
 *  "0-1" and "0-1 Room" / "Explorers" are handled.
 */
export function roomNameMatches(childRoom: string, room: Room): boolean {
  const child = (childRoom ?? '').toLowerCase();
  if (!child) return false;
  const aliases = [
    room.ownaRoomName,
    room.name,
    ...(room.roomAliases ?? []),
  ].filter((a): a is string => Boolean(a)).map(a => a.toLowerCase());
  return aliases.some(alias => child.includes(alias) || alias.includes(child));
}

export function buildRoomStatus(
  room: Room,
  allChildren: AttendanceChild[],
  rosteredStaff: RosteredStaff[],
  showCurrentOnly: boolean,
  currentTimeMins?: number, // Sydney time in minutes since midnight
): RoomRatioStatus {
  const roomChildren = allChildren.filter(c => {
    const roomMatch = roomNameMatches(c.room, room);
    if (!roomMatch) return false;
    if (showCurrentOnly) {
      if (!c.sign_in) return false;
      if (c.sign_out) return false;
      // If predicted_sign_out has already passed, treat as departed
      if (c.predicted_sign_out && currentTimeMins !== undefined) {
        const predMins = toShiftMins(c.predicted_sign_out);
        if (predMins !== null && predMins <= currentTimeMins) return false;
      }
      return true;
    }
    // All Day: show every record for this room — signed in, signed out, or booked but not yet arrived
    return true;
  });

  const { required, breakdown } = calcRequiredStaff(roomChildren);

  // When showing current state, only count staff whose shift is active right now
  const activeStaff = (showCurrentOnly && currentTimeMins !== undefined)
    ? rosteredStaff.filter(s => {
        const start = toShiftMins(s.startTime);
        const end   = toShiftMins(s.endTime);
        if (start === null) return true; // no time data, include
        const effectiveEnd = (end === null || end === 0) ? 24 * 60 : end;
        return start <= currentTimeMins && effectiveEnd > currentTimeMins;
      })
    : rosteredStaff;

  const staffCount = activeStaff.length;
  const shortage   = required - staffCount;

  const status = shortage > 0 ? 'red' : 'green';

  return {
    room,
    children: roomChildren,
    presentCount: roomChildren.length,
    ageBreakdown: breakdown,
    requiredStaff: required,
    rosteredStaff: activeStaff,
    staffCount,
    shortage,
    status,
  };
}
