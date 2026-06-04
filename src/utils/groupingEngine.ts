/**
 * Family Grouping Engine
 *
 * Determines the optimal room grouping at any point in time given:
 *  - Children present (by room/age from Owna)
 *  - Staff available (from Deputy shift starts)
 *  - NSW ratio requirements
 *  - Minimum 2 staff per active group
 *
 * Groups must be contiguous adjacent rooms (by age order).
 * Returns the most-split configuration that satisfies all constraints.
 */

import type { Room } from '../types';

// Inline ratio calculation (avoids AttendanceChild dependency)
export function calcRequired(children: { ageMonths: number }[]): number {
  let staff = 0, cap = 0;
  const u24 = children.filter(c => c.ageMonths < 24).length;
  const m24 = children.filter(c => c.ageMonths >= 24 && c.ageMonths < 36).length;
  const m36 = children.filter(c => c.ageMonths >= 36).length;
  const s1 = Math.ceil(u24 / 4); cap = s1 * 4; staff += s1;
  const leftover = Math.max(0, cap - u24);
  const rem24 = Math.max(0, m24 - leftover);
  const s2 = Math.ceil(rem24 / 5); cap = s2 * 5; staff += s2;
  const leftover2 = Math.max(0, cap - rem24);
  const rem36 = Math.max(0, m36 - leftover2);
  staff += Math.ceil(rem36 / 10);
  return Math.max(staff, children.length > 0 ? 1 : 0);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChildPresent {
  ageMonths: number;
  room: string; // ownaRoomName
}

export interface StaffAvailable {
  employeeId:   number;
  employeeName: string;
  shiftStart:   string; // HH:MM
  shiftEnd:     string;
  type:         'room' | 'float' | 'iss' | 'support';
  unitId:       number;
}

export interface RoomGroup {
  groupId:       string;           // unique key e.g. "0-1_2-3"
  label:         string;           // "Family Grouping", "Mixed 0-3 yrs", "0-1 Explorers"
  isFamilyGroup: boolean;          // true = all rooms combined
  isMixed:       boolean;          // true = some (not all) rooms combined
  rooms:         Room[];           // rooms in this group
  ageMinMonths:  number;
  ageMaxMonths:  number;
  childrenCount: number;
  staffNeeded:   number;           // max(2, ratioRequired)
  assignedStaff: StaffAvailable[]; // auto-assigned, director-modifiable
}

export interface GroupingResult {
  groups:        RoomGroup[];
  staffUsed:     number;
  staffAvail:    number;
  isOptimal:     boolean;  // true = most-split valid config
  canSplitMore:  boolean;  // true = more splitting would be possible with more staff
  suggestedAt:   string;   // ISO timestamp
}

export interface GroupingSession {
  id?:                  string;
  centreId:             string;
  date:                 string;
  sessionStart:         string;   // HH:MM
  sessionEnd:           string;   // HH:MM
  groupLabel:           string;
  roomsIncluded:        string[]; // room IDs
  staffIds:             number[];
  staffNames:           string[];
  staffRooms:           string[]; // parallel to staffIds — room ID each staff member is assigned to
  heldInRoom?:          string;   // which physical room the group is held in
  childrenCount:        number;
  confirmationStatus:   'suggested' | 'confirmed' | 'auto-confirmed' | 'modified' | 'reconstructed';
  confirmedBy?:         string;
  notes?:               string;
}

// ─── Core algorithm ───────────────────────────────────────────────────────────

/**
 * Enumerate all valid contiguous groupings for n rooms.
 * Returns array of partitions, each partition is array of arrays of room indices.
 * E.g. for 3 rooms: [[0,1,2]], [[0,1],[2]], [[0],[1,2]], [[0],[1],[2]]
 */
function enumerateGroupings(n: number): number[][][] {
  if (n === 0) return [[]];
  if (n === 1) return [[[0]]];

  const results: number[][][] = [];

  function generate(start: number, current: number[][]): void {
    if (start === n) {
      results.push(current.map(g => [...g]));
      return;
    }
    // Try all possible end points for the next group starting at `start`
    for (let end = start; end < n; end++) {
      const group = [];
      for (let i = start; i <= end; i++) group.push(i);
      generate(end + 1, [...current, group]);
    }
  }
  generate(0, []);
  return results;
}

/**
 * Calculate staff needed for a group of rooms with given children.
 * Applies minimum 2-staff rule.
 */
function staffNeededForGroup(children: ChildPresent[]): number {
  if (children.length === 0) return 0;
  return Math.max(2, calcRequired(children));
}

/**
 * Generate a human-readable label for a group of rooms.
 */
function groupLabel(rooms: Room[], allRooms: Room[]): { label: string; isFamilyGroup: boolean; isMixed: boolean } {
  if (rooms.length === allRooms.length) {
    return { label: 'Family Grouping', isFamilyGroup: true, isMixed: false };
  }
  if (rooms.length === 1) {
    return { label: rooms[0].name, isFamilyGroup: false, isMixed: false };
  }
  // Mixed group — label by age range
  const minAge = rooms[0].ageGroup.split('-')[0].trim();
  const maxAge = rooms[rooms.length - 1].ageGroup.split('-').pop()?.trim() ?? '';
  return { label: `Mixed ${minAge}–${maxAge}`, isFamilyGroup: false, isMixed: true };
}

/**
 * Main grouping engine.
 * Returns the optimal grouping given staff and children at a specific time.
 */
export function computeOptimalGrouping(
  rooms:             Room[],
  childrenByRoom:    Record<string, ChildPresent[]>, // keyed by room.id
  staffAvailable:    StaffAvailable[],
  _currentTimeMins:  number,    // minutes since midnight (unused — caller pre-filters staffAvailable)
  _minChildrenToSplit = 3,      // min children in a room to justify splitting it out
): GroupingResult {
  // Use all provided staff — time-based filtering (morning lookahead / afternoon
  // still-on-shift) is handled upstream in GroupingPanel's staffTimeline builder.
  const activeStaff = staffAvailable;
  const staffCount  = activeStaff.length;

  const n = rooms.length;
  const allGroupings = enumerateGroupings(n);

  // Evaluate each configuration
  const valid: { partition: number[][]; staffNeeded: number; groupCount: number }[] = [];

  for (const partition of allGroupings) {
    let totalStaffNeeded = 0;
    let hasEmptyGroup   = false;

    for (const indices of partition) {
      const groupRooms = indices.map(i => rooms[i]);
      const children: ChildPresent[] = groupRooms.flatMap(r => childrenByRoom[r.id] ?? []);

      if (children.length === 0) {
        hasEmptyGroup = true;
        break;
      }
      totalStaffNeeded += staffNeededForGroup(children);
    }

    if (hasEmptyGroup) continue;
    if (totalStaffNeeded > staffCount) continue;

    // Check average group size meets minimum — this enforces total-children thresholds.
    // e.g. minChildrenToSplit=8 means you need 16 total to split into 2, 24 for 3, etc.
    const totalKids = partition.reduce((sum, indices) =>
      sum + indices.flatMap(i => childrenByRoom[rooms[i].id] ?? []).length, 0);
    const avgGroupSize = partition.length > 0 ? totalKids / partition.length : 0;
    if (avgGroupSize < _minChildrenToSplit) continue;

    valid.push({ partition, staffNeeded: totalStaffNeeded, groupCount: partition.length });
  }

  if (valid.length === 0) {
    // Fallback: all combined (Family Grouping)
    const allChildren = rooms.flatMap(r => childrenByRoom[r.id] ?? []);
    const needed = allChildren.length > 0 ? staffNeededForGroup(allChildren) : 0;

    return {
      groups: allChildren.length === 0 ? [] : [{
        groupId:       'family',
        label:         'Family Grouping',
        isFamilyGroup: true,
        isMixed:       false,
        rooms,
        ageMinMonths:  0,
        ageMaxMonths:  72,
        childrenCount: allChildren.length,
        staffNeeded:   needed,
        assignedStaff: activeStaff.slice(0, needed),
      }],
      staffUsed:    needed,
      staffAvail:   staffCount,
      isOptimal:    false,
      canSplitMore: false,
      suggestedAt:  new Date().toISOString(),
    };
  }

  // Pick most-split valid config (most groups) — ties broken by fewest staff needed
  valid.sort((a, b) => b.groupCount - a.groupCount || a.staffNeeded - b.staffNeeded);
  const best = valid[0];

  // Build RoomGroup objects
  let staffPool = [...activeStaff];
  const groups: RoomGroup[] = best.partition.map(indices => {
    const groupRooms = indices.map(i => rooms[i]);
    const children   = groupRooms.flatMap(r => childrenByRoom[r.id] ?? []);
    const needed     = staffNeededForGroup(children);
    const { label, isFamilyGroup, isMixed } = groupLabel(groupRooms, rooms);

    // Assign staff from pool (prefer room staff for their own room, then floats)
    const roomUnitIds = new Set(groupRooms.map(r => r.deputyUnitId));
    const preferred   = staffPool.filter(s => roomUnitIds.has(s.unitId));
    const other       = staffPool.filter(s => !roomUnitIds.has(s.unitId));
    const assigned    = [...preferred, ...other].slice(0, needed);
    staffPool         = staffPool.filter(s => !assigned.includes(s));

    const ageMonths   = children.map(c => c.ageMonths);
    return {
      groupId:       groupRooms.map(r => r.id).join('_'),
      label,
      isFamilyGroup,
      isMixed,
      rooms:         groupRooms,
      ageMinMonths:  ageMonths.length ? Math.min(...ageMonths) : 0,
      ageMaxMonths:  ageMonths.length ? Math.max(...ageMonths) : 72,
      childrenCount: children.length,
      staffNeeded:   needed,
      assignedStaff: assigned,
    };
  });

  // Check if more splitting is theoretically possible with more staff
  const nextSplit = valid.find(v => v.groupCount > best.groupCount);
  const canSplitMore = !!(nextSplit);

  return {
    groups,
    staffUsed:    best.staffNeeded,
    staffAvail:   staffCount,
    isOptimal:    true,
    canSplitMore,
    suggestedAt:  new Date().toISOString(),
  };
}

/**
 * Compute the transition points throughout a day where the optimal grouping changes.
 * Used for both real-time dashboard and historical reconstruction.
 */
export function computeDayTransitions(
  rooms:              Room[],
  childrenTimeline:   { timeMins: number; childrenByRoom: Record<string, ChildPresent[]> }[],
  staffTimeline:      { timeMins: number; staffAvailable: StaffAvailable[] }[],
  openMins:           number = 7 * 60,
  closeMins:          number = 18 * 60,
  debounceMins:       number = 15,
  minChildrenToSplit: number = 3,
): { timeMins: number; result: GroupingResult }[] {
  const transitions: { timeMins: number; result: GroupingResult }[] = [];
  let lastGroupIds: string = '';

  for (let t = openMins; t <= closeMins; t += debounceMins) {
    const childSnap = [...childrenTimeline].reverse().find(s => s.timeMins <= t);
    const staffSnap = [...staffTimeline].reverse().find(s => s.timeMins <= t);
    if (!childSnap || !staffSnap) continue;

    const result = computeOptimalGrouping(rooms, childSnap.childrenByRoom, staffSnap.staffAvailable, t, minChildrenToSplit);
    const groupIds = result.groups.map(g => g.groupId).join('|');

    if (groupIds !== lastGroupIds) {
      transitions.push({ timeMins: t, result });
      lastGroupIds = groupIds;
    }
  }

  return transitions;
}

/**
 * Convert a GroupingResult into GroupingSession records for persistence.
 */
export function groupingResultToSessions(
  result:         GroupingResult,
  centreId:       string,
  date:           string,
  startMins:      number,
  endMins:        number,
  childrenByRoom: Record<string, ChildPresent[]> = {},
  status:         GroupingSession['confirmationStatus'] = 'suggested',
): GroupingSession[] {
  return result.groups.map(g => ({
    centreId,
    date,
    sessionStart:       `${String(Math.floor(startMins / 60)).padStart(2, '0')}:${String(startMins % 60).padStart(2, '0')}`,
    sessionEnd:         `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`,
    groupLabel:         g.label,
    roomsIncluded:      g.rooms.map(r => r.id),
    staffIds:           g.assignedStaff.map(s => s.employeeId),
    staffNames:         g.assignedStaff.map(s => s.employeeName),
    staffRooms:         g.assignedStaff.map(s => {
      const match = g.rooms.find(r => r.deputyUnitId === s.unitId);
      return match ? match.id : (g.rooms[0]?.id ?? '');
    }),
    // Default held-in room: room with most children, or first room
    heldInRoom:         g.rooms.reduce((best, r) => {
      const bc = (childrenByRoom[best] ?? []).length;
      const rc = (childrenByRoom[r.id] ?? []).length;
      return rc > bc ? r.id : best;
    }, g.rooms[0]?.id ?? ''),
    childrenCount:      g.childrenCount,
    confirmationStatus: status,
  }));
}
