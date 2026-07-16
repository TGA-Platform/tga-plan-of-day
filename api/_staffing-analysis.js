/**
 * Pure staffing-analysis calculator.
 *
 * Mirrors the logic in src/pages/RatioDashboardPage.tsx FloatPoolSection and
 * buildRoomStatus so the forecast email produces identical numbers to the Plan
 * of Day Staffing Analysis panel.
 *
 * Keep this file in sync with RatioDashboardPage.tsx. If the dashboard logic
 * changes, update this file to match.
 */

const AGE_BRACKETS = [
  { label: '0–2 yrs', minMonths: 0, maxMonths: 24, ratio: 4 },
  { label: '2–3 yrs', minMonths: 24, maxMonths: 36, ratio: 5 },
  { label: '3–6 yrs', minMonths: 36, maxMonths: 999, ratio: 10 },
];

function parseAgeMonths(ageStr) {
  if (!ageStr) return -1;
  const yearMatch = String(ageStr).match(/(\d+)y/);
  const monthMatch = String(ageStr).match(/(\d+)m/);
  const years = yearMatch ? parseInt(yearMatch[1], 10) : 0;
  const months = monthMatch ? parseInt(monthMatch[1], 10) : 0;
  return years * 12 + months;
}

function calcRequiredStaff(children) {
  const groups = AGE_BRACKETS.map(b => ({
    ...b,
    count: children.filter(c => c.ageMonths >= b.minMonths && c.ageMonths < b.maxMonths && c.ageMonths >= 0).length,
    staffAllocated: 0,
  }));

  let totalStaff = 0;
  let carryover = 0;

  for (const group of groups) {
    if (group.count === 0) continue;

    const coveredByCarryover = Math.min(group.count, carryover);
    const stillNeeded = group.count - coveredByCarryover;
    const newStaff = Math.ceil(stillNeeded / group.ratio);

    group.staffAllocated = newStaff;
    totalStaff += newStaff;

    const unusedFromNew = newStaff * group.ratio - stillNeeded;
    const unusedFromCarryover = carryover - coveredByCarryover;
    carryover = unusedFromNew + unusedFromCarryover;
  }

  return {
    required: totalStaff,
    breakdown: groups.filter(g => g.count > 0).map(g => ({
      bracket: g.label,
      count: g.count,
      ratio: g.ratio,
      staffAllocated: g.staffAllocated,
    })),
  };
}

function toShiftMins(t) {
  if (!t) return null;
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const sydney = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    return sydney.getHours() * 60 + sydney.getMinutes();
  }
  const parts = String(t).split(':').map(Number);
  if (parts.length >= 2 && !isNaN(parts[0])) return parts[0] * 60 + (parts[1] || 0);
  return null;
}

function roomNameMatches(childRoom, room) {
  const child = (childRoom ?? '').toLowerCase();
  if (!child) return false;
  const aliases = [
    room.ownaRoomName,
    room.name,
    ...(room.roomAliases ?? []),
  ].filter(Boolean).map(a => a.toLowerCase());
  return aliases.some(alias => child.includes(alias) || alias.includes(child));
}

function buildRoomStatus(room, allChildren, rosteredStaff, showCurrentOnly, currentTimeMins) {
  const roomChildren = allChildren.filter(c => {
    const roomMatch = roomNameMatches(c.room, room);
    if (!roomMatch) return false;
    if (showCurrentOnly) {
      if (!c.sign_in) return false;
      if (c.sign_out) return false;
      if (c.predicted_sign_out && currentTimeMins !== undefined) {
        const predMins = toShiftMins(c.predicted_sign_out);
        if (predMins !== null && predMins <= currentTimeMins) return false;
      }
      return true;
    }
    return true;
  });

  const { required } = calcRequiredStaff(roomChildren);

  const activeStaff = (showCurrentOnly && currentTimeMins !== undefined)
    ? rosteredStaff.filter(s => {
        const start = toShiftMins(s.startTime);
        const end = toShiftMins(s.endTime);
        if (start === null) return true;
        const effectiveEnd = (end === null || end === 0) ? 24 * 60 : end;
        return start <= currentTimeMins && effectiveEnd > currentTimeMins;
      })
    : rosteredStaff;

  const staffCount = activeStaff.length;
  const shortage = required - staffCount;

  return {
    room,
    children: roomChildren,
    presentCount: roomChildren.length,
    requiredStaff: required,
    rosteredStaff: activeStaff,
    staffCount,
    shortage,
    status: shortage > 0 ? 'red' : 'green',
  };
}

function normName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isAdStaff(staff) {
  const un = (staff.unitName ?? '').toLowerCase();
  return un.includes('assistant director') || un.includes('asst director') || un.includes('ass. director');
}

function overlapsCoreWindow(startTime, endTime) {
  const WINDOW_START = 10 * 60; // 10:00
  const USEFUL_START_CUTOFF = 13 * 60 + 30; // 13:30
  const s = toShiftMins(startTime);
  const e = toShiftMins(endTime);
  if (s === null || e === null) return true;
  return e > WINDOW_START && s < USEFUL_START_CUTOFF;
}

/**
 * Calculate staffing analysis numbers matching RatioDashboardPage FloatPoolSection.
 *
 * @param {Object} params
 * @param {Object} params.centre - centre config with rooms, floatUnitIds, etc.
 * @param {string} params.date - YYYY-MM-DD
 * @param {Array} params.children - attendance/expected child rows { room, ageMonths, sign_in?, sign_out?, predicted_sign_out? }
 * @param {Array} params.rosters - raw Deputy roster rows (from /api/deputy-rosters)
 * @param {Set<string>} [params.internalCasualSet]
 * @param {number} [params.zCasualFloatCount=0]
 * @param {Record<number,string>} [params.staffMoves]
 * @param {boolean} [params.isFutureDate=false]
 * @param {Object} [params.forecastRes] - room-forecast response for future-date trimming
 * @param {boolean} [params.showCurrentOnly=false]
 * @param {number} [params.currentTimeMins]
 */
export function calculateStaffingAnalysis(params) {
  const {
    centre,
    date,
    children: rawChildren,
    rosters,
    internalCasualSet = new Set(),
    zCasualFloatCount = 0,
    staffMoves = {},
    isFutureDate = false,
    forecastRes = null,
    showCurrentOnly = false,
    currentTimeMins,
  } = params;

  const roomUnitIds = centre.rooms.map(r => r.deputyUnitId);
  const floatUnitIds = centre.floatUnitIds ?? [];
  const issUnitIds = centre.issUnitIds ?? [];
  const leaveUnitIds = centre.leaveUnitIds ?? [];
  const nonRatioUnitIds = centre.nonRatioUnitIds ?? [];
  const allUnitIds = new Set([...roomUnitIds, ...floatUnitIds, ...issUnitIds, ...leaveUnitIds, ...nonRatioUnitIds]);

  // 1. Normalize rosters to RosteredStaff-like shape.
  const allRosters = (rosters || [])
    .filter(r => r.Employee && r.Employee !== 0 && allUnitIds.has(r.OperationalUnit))
    .map(r => {
      const empInfo = r._DPMetaData?.EmployeeInfo || {};
      const displayName = empInfo.DisplayName || '';
      const fullName = (empInfo.FirstName && empInfo.LastName)
        ? `${empInfo.FirstName} ${empInfo.LastName}`.trim()
        : '';
      const unitInfo = r._DPMetaData?.OperationalUnitInfo || {};
      return {
        employeeId: r.Employee,
        employeeName: fullName || displayName || `Staff #${r.Employee}`,
        startTime: r.StartTime || '',
        endTime: r.EndTime || '',
        unitId: r.OperationalUnit,
        unitName: unitInfo.OperationalUnitName || '',
        isSplitShift: r.isSplitShift ?? false,
        splitSegments: r.splitSegments,
        isInternalCasual: internalCasualSet.has(normName(fullName || displayName || '')),
      };
    });

  const leaveSet = new Set(leaveUnitIds);
  const floatSet = new Set(floatUnitIds);
  const nonRatioSet = new Set(nonRatioUnitIds);
  const issSet = new Set(issUnitIds);

  const leaveRosters = allRosters.filter(r => leaveSet.has(r.unitId));
  const floatRosters = allRosters.filter(r => floatSet.has(r.unitId) && !r.isSplitShift);
  const splitShiftFloats = allRosters.filter(r => floatSet.has(r.unitId) && r.isSplitShift);
  const issRosters = allRosters.filter(r => issSet.has(r.unitId));
  const supportRosters = [
    ...allRosters.filter(r => nonRatioSet.has(r.unitId)),
    ...splitShiftFloats,
  ];

  // 2. Trim children per room to room-forecast expected counts for future dates.
  let childRows = (rawChildren || []).map(c => ({
    ...c,
    ageMonths: c.ageMonths ?? parseAgeMonths(c.age),
  }));

  if (isFutureDate && forecastRes?.rooms) {
    for (const room of centre.rooms) {
      const owna = (room.ownaRoomName ?? room.name).toLowerCase();
      const forecastEntry = Object.entries(forecastRes.rooms || {})
        .find(([roomName]) => {
          const rn = roomName.toLowerCase();
          return rn.includes(owna) || owna.includes(rn);
        });
      const expectedCount = forecastEntry?.[1]?.expected;
      if (expectedCount != null) {
        const roomKids = childRows
          .filter(ch => roomNameMatches(ch.room, room))
          .sort((a, b) => (a.ageMonths ?? 999) - (b.ageMonths ?? 999))
          .slice(0, expectedCount);
        const otherKids = childRows.filter(ch => !roomNameMatches(ch.room, room));
        childRows = [...otherKids, ...roomKids];
      }
    }
  }

  // 3. Build initial room statuses from raw rosters.
  const roomStatuses = centre.rooms.map(room => {
    const roomStaff = allRosters.filter(r => r.unitId === room.deputyUnitId);
    return buildRoomStatus(room, childRows, roomStaff, showCurrentOnly, currentTimeMins);
  });

  // 4. Apply staffMoves to get effective room statuses, mirroring effectiveRoomStatuses.
  const hasOverrides = Object.keys(staffMoves).length > 0;
  let effectiveRoomStatuses = roomStatuses;

  if (hasOverrides) {
    const staffOrigin = new Map();
    roomStatuses.forEach(rs => rs.rosteredStaff.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: rs.room.id })));
    floatRosters.forEach(f => staffOrigin.set(f.employeeId, { staff: f, roomId: 'float' }));
    supportRosters.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: 'support' }));
    issRosters.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: 'iss' }));

    effectiveRoomStatuses = roomStatuses.map(rs => {
      const staying = rs.rosteredStaff.filter(s => {
        const dest = staffMoves[s.employeeId];
        return dest === undefined || dest === rs.room.id;
      });
      const movedIn = [...staffOrigin.values()]
        .filter(({ staff: s, roomId }) => staffMoves[s.employeeId] === rs.room.id && roomId !== rs.room.id)
        .map(({ staff }) => staff);
      const issMovedHere = issRosters.filter(s =>
        staffMoves[s.employeeId] === rs.room.id &&
        !staying.some(x => x.employeeId === s.employeeId) &&
        !movedIn.some(x => x.employeeId === s.employeeId)
      );
      return buildRoomStatus(rs.room, childRows, [...staying, ...movedIn, ...issMovedHere], showCurrentOnly, currentTimeMins);
    });
  }

  // 5. Compute shortage/surplus.
  const shortageRooms = effectiveRoomStatuses
    .filter(r => r.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage);
  const surplusRooms = effectiveRoomStatuses
    .filter(r => r.shortage < 0)
    .sort((a, b) => a.shortage - b.shortage);

  const totalRatioShortage = shortageRooms.reduce((sum, r) => sum + r.shortage, 0);
  const totalSurplus = surplusRooms.reduce((sum, r) => sum + Math.abs(r.shortage), 0);
  const surplusCoveringShortage = Math.min(totalSurplus, totalRatioShortage);
  const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);

  // 6. Float filtering (same as RatioDashboardPage effectiveFloats).
  const adStaff = supportRosters.filter(isAdStaff);
  const adIds = new Set(adStaff.map(s => s.employeeId));

  const supportAsFloats = supportRosters.filter(s => staffMoves[s.employeeId] === 'float' && !adIds.has(s.employeeId));
  const roomStaffAsFloats = roomStatuses.flatMap(rs => rs.rosteredStaff).filter(s => staffMoves[s.employeeId] === 'float');

  let effectiveFloats;
  if (!hasOverrides) {
    effectiveFloats = [...floatRosters, ...supportAsFloats];
  } else {
    effectiveFloats = [
      ...floatRosters.filter(f => !staffMoves[f.employeeId] || staffMoves[f.employeeId] === 'float'),
      ...supportAsFloats,
      ...roomStaffAsFloats,
    ];
  }

  effectiveFloats = effectiveFloats.filter(f => {
    if (staffMoves[f.employeeId]) return true;
    if (f.isSplitShift) return false;
    return overlapsCoreWindow(f.startTime, f.endTime);
  });

  // 7. Staffing analysis numbers.
  const totalFloorStaff = effectiveRoomStatuses.reduce((sum, r) => sum + r.staffCount, 0);
  const bufferRequired = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;

  const centreChildCount = childRows.length;
  const adAvailable = (centreChildCount > 0 && centreChildCount < 100) ? adStaff.length : 0;

  const roomNetSurplus = Math.max(0, totalSurplus - totalRatioShortage);
  const internalFloatCount = effectiveFloats.length;
  const floatCount = internalFloatCount + zCasualFloatCount;
  const effectiveFloatCount = floatCount + roomNetSurplus;

  const totalFloatersNeeded = Math.max(0, netShortageAfterRealloc + bufferRequired);
  const casualsNeeded = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvailable);
  const casualsFull = Math.floor(casualsNeeded);
  const casualsHalf = casualsNeeded - casualsFull >= 0.5 ? 1 : 0;
  const coverageOk = casualsNeeded <= 0;
  const floatSurplus = casualsNeeded <= 0 ? (effectiveFloatCount + adAvailable - totalFloatersNeeded) : 0;

  return {
    centreId: centre.id,
    name: centre.name,
    campus: centre.ownaName ?? centre.name,
    date,
    expectedChildren: centreChildCount,
    requiredStaff: effectiveRoomStatuses.reduce((sum, r) => sum + r.requiredStaff, 0),
    floorStaff: totalFloorStaff,
    floatCount,
    internalFloatCount,
    zCasualFloatCount,
    adAvailable,
    casualsNeeded,
    casualsFull,
    casualsHalf,
    floatSurplus,
    roomNetSurplus,
    coverageOk,
    surplusVal: casualsNeeded > 0 ? -casualsNeeded : floatSurplus,
    totalFloatersNeeded,
    bufferRequired,
    totalRatioShortage,
    totalSurplus,
    netShortageAfterRealloc,
    shortageRooms: shortageRooms.map(r => ({ name: r.room.name, shortage: r.shortage })),
    surplusRooms: surplusRooms.map(r => ({ name: r.room.name, surplus: Math.abs(r.shortage) })),
    roomData: effectiveRoomStatuses.map(rs => ({
      room: rs.room.name,
      expected: rs.presentCount,
      required: rs.requiredStaff,
      staffCount: rs.staffCount,
      shortage: rs.shortage,
    })),
  };
}
