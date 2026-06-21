/**
 * SummaryTab — Day Summary
 *
 * Compares the Plan of the Day (main dashboard DnD moves) against the
 * Ratio Check (per-slot adjustments, off-floor activities, time overrides,
 * and comments) to produce a clean end-of-plan summary.
 *
 * Data sources:
 *   - allRosters       : raw Deputy roster (original planned roster)
 *   - staffMoves       : day-level moves from main dashboard DnD
 *   - rooms/centre     : centre config
 *   - /api/ratio-check : saved per-slot ratio check sessions
 */
import { useState, useEffect } from 'react';
import type { Room, RosteredStaff } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RatioCheckSession {
  cells: Record<string, { children: number }>;
  staffAvailableOverride: Record<string, number>;
  comments: Record<string, string>;
  familyGroupings: unknown[];
  staffMoves: Record<string, string>;       // "${empId}:${slot}" → roomId | special
  staffTimeOverrides: Record<string, { start: string; end: string }>;
}

type ActivityKey = '__additional__' | '__programming__' | '__lunch__' | '__cleaning__';
const ACTIVITY_LABELS: Record<ActivityKey, string> = {
  '__additional__':  'Additional Duties',
  '__programming__': 'Programming',
  '__lunch__':       'Lunch Cover',
  '__cleaning__':    'Cleaning',
};
const ACTIVITY_COLORS: Record<ActivityKey, { bg: string; text: string }> = {
  '__additional__':  { bg: '#fef3c7', text: '#92400e' },
  '__programming__': { bg: '#dbeafe', text: '#1e40af' },
  '__lunch__':       { bg: '#ccfbf1', text: '#0f766e' },
  '__cleaning__':    { bg: '#ede9fe', text: '#7e22ce' },
};

function isActivity(id: string): id is ActivityKey {
  return ['__additional__','__programming__','__lunch__','__cleaning__'].includes(id);
}

// Full ordered slot sequence (mirrors RatioCheckPanel constants)
const ALL_SLOTS = [
  '07:00','07:15','07:30','07:45',
  '08:00','08:15','08:30','08:45',
  '09:00','09:15','09:30','09:45',
  '10:00','10:30',
  '11:00','11:30',
  '12:00','12:30',
  '13:00','13:30',
  '14:00','14:30',
  '15:00','15:30','15:45',
  '16:00','16:15','16:30','16:45',
  '17:00','17:15','17:30','17:45',
  '18:00',
];

// Given a slot start time, return its end time (= next slot start, or +15min for last)
function slotEnd(slot: string): string {
  const idx = ALL_SLOTS.indexOf(slot);
  if (idx >= 0 && idx < ALL_SLOTS.length - 1) return ALL_SLOTS[idx + 1];
  // Fallback: add 15 minutes
  const [h, m = 0] = slot.split(':').map(Number);
  const total = h * 60 + m + 15;
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}

// Collapse a sorted list of slot start times into contiguous ranges, returned as "Xam–Yam"
function slotsToRanges(sorted: string[]): string {
  if (sorted.length === 0) return '';
  const ranges: string[] = [];
  let rangeStart = sorted[0];
  let rangeEnd   = slotEnd(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === rangeEnd) {
      // Contiguous — extend the range
      rangeEnd = slotEnd(sorted[i]);
    } else {
      ranges.push(`${to12h(rangeStart)}–${to12h(rangeEnd)}`);
      rangeStart = sorted[i];
      rangeEnd   = slotEnd(sorted[i]);
    }
  }
  ranges.push(`${to12h(rangeStart)}–${to12h(rangeEnd)}`);
  return ranges.join(', ');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function to12h(hhmm: string): string {
  if (!hhmm || hhmm === '—') return hhmm;
  const parts = hhmm.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0; // default 0 if no minutes part (e.g. legacy slot keys like "9")
  if (isNaN(h)) return hhmm; // not a time string — return as-is
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2,'0')}${ampm}`;
}

function rosterTimeStr(t: string | number | null | undefined): string {
  if (!t) return '—';
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const h = d.toLocaleString('en-AU', { hour: '2-digit', hour12: false, timeZone: 'Australia/Sydney' });
    const m = d.getMinutes();
    return to12h(`${h.padStart(2,'0')}:${String(m).padStart(2,'0')}`);
  }
  return to12h(String(t).slice(0,5));
}



// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  centreId:    string;
  date:        string;
  rooms:       Room[];
  allRosters:  RosteredStaff[];
  staffMoves:  Record<number, string>;      // day-level DnD from main dashboard
  floatUnitIds: number[];
  leaveUnitIds: number[];
  issUnitIds:  number[];
  nonRatioUnitIds: number[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SummaryTab({
  centreId, date, rooms, allRosters, staffMoves,
  floatUnitIds, leaveUnitIds, issUnitIds, nonRatioUnitIds,
}: Props) {
  const [sessions, setSessions] = useState<{ session: string; data: RatioCheckSession }[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const r = await fetch(`/api/ratio-check?centre_id=${encodeURIComponent(centreId)}&date=${date}`);
        if (!cancelled && r.ok) setSessions(await r.json());
      } catch { /* offline */ }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [centreId, date]);

  // Build a name lookup from allRosters
  const nameOf = (empId: number): string => {
    const r = allRosters.find(s => s.employeeId === empId);
    return r?.employeeName ?? `Staff #${empId}`;
  };

  // ── Day-level moves (from main dashboard DnD) ──────────────────────────────
  const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
  const floatSet = new Set(floatUnitIds);
  const leaveSet = new Set(leaveUnitIds);
  const issSet   = new Set(issUnitIds);
  const nonRatioSet = new Set(nonRatioUnitIds);

  const roomRosters = allRosters.filter(r => rooms.some(rm => rm.deputyUnitId === r.unitId) && !leaveSet.has(r.unitId));
  const floatRosters = allRosters.filter(r => floatSet.has(r.unitId));


  // Which staff had day-level moves?
  const dayMovedStaff = Object.entries(staffMoves).map(([empIdStr, dest]) => {
    const empId = parseInt(empIdStr);
    const staff = allRosters.find(s => s.employeeId === empId);
    if (!staff) return null;
    const fromRoom = rooms.find(r => r.deputyUnitId === staff.unitId);
    const fromLabel = fromRoom?.name
      ?? (floatSet.has(staff.unitId) ? 'Float Pool'
      : issSet.has(staff.unitId) ? 'ISS Pool'
      : nonRatioSet.has(staff.unitId) ? 'Support'
      : 'Unknown');
    const toLabel = roomById[dest]?.name
      ?? (dest === 'float' ? 'Float Pool'
      : dest === 'support' ? 'Support'
      : dest === 'iss' ? 'ISS Pool'
      : dest);
    return { empId, name: staff.employeeName, fromLabel, toLabel, dest };
  }).filter((x): x is NonNullable<typeof x> => x !== null && x.fromLabel !== x.toLabel);

  // ── Ratio Check changes ─────────────────────────────────────────────────────
  // Collect all slot-level moves across all sessions
  interface SlotMove { empId: number; slot: string; session: string; dest: string }
  interface TimeOverride { empId: number; start: string; end: string }
  interface Comment { slot: string; session: string; text: string }

  const slotMoves: SlotMove[] = [];
  const timeOverrides: TimeOverride[] = [];
  const comments: Comment[] = [];

  for (const { session, data } of sessions) {
    // Slot moves
    for (const [key, dest] of Object.entries(data.staffMoves ?? {})) {
      const [empIdStr, slot] = key.split(':');
      const empId = parseInt(empIdStr);
      if (!isNaN(empId) && slot) slotMoves.push({ empId, slot, session, dest });
    }
    // Time overrides
    for (const [empIdStr, times] of Object.entries(data.staffTimeOverrides ?? {})) {
      const empId = parseInt(empIdStr);
      if (!isNaN(empId)) timeOverrides.push({ empId, start: times.start, end: times.end });
    }
    // Comments
    for (const [slot, text] of Object.entries(data.comments ?? {})) {
      if (text.trim()) comments.push({ slot, session, text });
    }
  }

  // Group slot moves by staff member
  const slotMovesByStaff = slotMoves.reduce<Record<number, SlotMove[]>>((acc, m) => {
    (acc[m.empId] ??= []).push(m);
    return acc;
  }, {});

  // Activities: group by destination
  const activitiesByDest = slotMoves
    .filter(m => isActivity(m.dest))
    .reduce<Record<string, SlotMove[]>>((acc, m) => {
      (acc[m.dest] ??= []).push(m);
      return acc;
    }, {});

  // All staff who had any change (day-level OR slot-level)
  const changedEmpIds = new Set([
    ...dayMovedStaff.map(s => s.empId),
    ...slotMoves.map(m => m.empId),
    ...timeOverrides.map(t => t.empId),
  ]);

  const hasChanges = changedEmpIds.size > 0 || comments.length > 0;

  // Sort comments by time
  const sortedComments = [...comments].sort((a, b) => a.slot.localeCompare(b.slot));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold" style={{ color: '#2d5c18' }}>📋 Day Summary</h2>
          <p className="text-xs mt-0.5" style={{ color: '#596570' }}>
            Comparing Plan of the Day roster moves with Ratio Check adjustments
          </p>
        </div>
        {!hasChanges && !loading && (
          <span className="text-xs px-3 py-1 rounded-full font-semibold"
            style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
            ✅ No changes — running to original roster
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm italic text-center py-8" style={{ color: '#9ca3af' }}>Loading ratio check data…</div>
      ) : (<>

        {/* ── Section 1: Room assignments ── */}
        <div className="rounded-2xl border overflow-hidden shadow-sm" style={{ borderColor: '#D0E8B8' }}>
          <div className="px-5 py-3" style={{ backgroundColor: '#F5FAF3' }}>
            <span className="text-sm font-bold" style={{ color: '#2d5c18' }}>🏫 Room Assignments</span>
            <span className="text-xs ml-2" style={{ color: '#596570' }}>Original roster + Plan of Day moves</span>
          </div>
          <div className="divide-y" style={{ borderColor: '#e8f0e4' }}>
            {rooms.map(room => {
              const originalStaff = roomRosters.filter(r => r.unitId === room.deputyUnitId);
              // Staff moved INTO this room via day-level DnD
              const movedIn = dayMovedStaff.filter(m => m.dest === room.id);
              // Staff moved OUT of this room
              const movedOut = dayMovedStaff.filter(m =>
                originalStaff.some(s => s.employeeId === m.empId)
              );
              const effectiveStaff = [
                ...originalStaff.filter(s => !movedOut.some(m => m.empId === s.employeeId)),
                ...movedIn.map(m => allRosters.find(s => s.employeeId === m.empId)!).filter(Boolean),
              ];
              return (
                <div key={room.id} className="px-5 py-3">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-semibold" style={{ color: '#2d5c18' }}>{room.name}</span>
                    <span className="text-xs" style={{ color: '#596570' }}>{room.ageGroup}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full ml-auto"
                      style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                      {effectiveStaff.length} staff
                    </span>
                  </div>
                  <div className="space-y-1">
                    {effectiveStaff.map((s, i) => {
                      if (!s) return null;
                      const wasMovedIn = movedIn.some(m => m.empId === s.employeeId);
                      const hasTOv = timeOverrides.find(t => t.empId === s.employeeId);
                      const slotActivity = slotMovesByStaff[s.employeeId]?.filter(m => isActivity(m.dest));
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                          {wasMovedIn ? (
                            <span className="px-2 py-0.5 rounded-full font-semibold"
                              style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>
                              ← moved in
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full font-semibold"
                              style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                              rostered
                            </span>
                          )}
                          <span className="font-medium" style={{ color: '#1f2937' }}>{s.employeeName}</span>
                          <span style={{ color: '#9ca3af' }}>
                            {hasTOv
                              ? <><s style={{ opacity: 0.5 }}>{rosterTimeStr(s.startTime)}–{rosterTimeStr(s.endTime)}</s>{' '}<span style={{ color: '#6366f1', fontWeight: 600 }}>{to12h(hasTOv.start)}–{to12h(hasTOv.end)}</span> (adjusted)</>
                              : <>{rosterTimeStr(s.startTime)}–{rosterTimeStr(s.endTime)}</>
                            }
                          </span>
                          {slotActivity && slotActivity.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded font-medium"
                              style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                              off-floor {slotActivity.length} slot{slotActivity.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {movedOut.map((m, i) => (
                      <div key={`out-${i}`} className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
                          → moved out
                        </span>
                        <span className="font-medium line-through" style={{ color: '#9ca3af' }}>{m.name}</span>
                        <span style={{ color: '#9ca3af' }}>→ {m.toLabel}</span>
                      </div>
                    ))}
                    {effectiveStaff.length === 0 && movedOut.length === 0 && (
                      <p className="text-xs italic" style={{ color: '#9ca3af' }}>No staff rostered</p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Float pool */}
            {floatRosters.length > 0 && (
              <div className="px-5 py-3">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-semibold" style={{ color: '#2d5c18' }}>🌊 Float Pool</span>
                  <span className="text-xs px-2 py-0.5 rounded-full ml-auto"
                    style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                    {floatRosters.filter(f => !dayMovedStaff.some(m => m.empId === f.employeeId && m.dest !== 'float')).length} remaining
                  </span>
                </div>
                <div className="space-y-1">
                  {floatRosters.map((s, i) => {
                    const moved = dayMovedStaff.find(m => m.empId === s.employeeId);
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                        {moved ? (
                          <span className="px-2 py-0.5 rounded-full font-semibold"
                            style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>
                            → {moved.toLabel}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full font-semibold"
                            style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                            available
                          </span>
                        )}
                        <span className="font-medium" style={{ color: '#1f2937' }}>{s.employeeName}</span>
                        <span style={{ color: '#9ca3af' }}>{rosterTimeStr(s.startTime)}–{rosterTimeStr(s.endTime)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Section 2: Ratio Check adjustments ── */}
        {(slotMoves.length > 0 || timeOverrides.length > 0) && (
          <div className="rounded-2xl border overflow-hidden shadow-sm" style={{ borderColor: '#c7d2fe' }}>
            <div className="px-5 py-3" style={{ backgroundColor: '#eef2ff' }}>
              <span className="text-sm font-bold" style={{ color: '#3730a3' }}>📊 Ratio Check Adjustments</span>
              <span className="text-xs ml-2" style={{ color: '#6366f1' }}>
                {slotMoves.length} slot move{slotMoves.length !== 1 ? 's' : ''}
                {timeOverrides.length > 0 && ` · ${timeOverrides.length} time override${timeOverrides.length !== 1 ? 's' : ''}`}
              </span>
            </div>
            <div className="px-5 py-4 space-y-4 bg-white">

              {/* Time overrides */}
              {timeOverrides.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#6b7280' }}>
                    ⏱ Shift Time Adjustments
                  </div>
                  <div className="space-y-1.5">
                    {timeOverrides.map((t, i) => {
                      const s = allRosters.find(r => r.employeeId === t.empId);
                      return (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className="font-semibold" style={{ color: '#374151' }}>{nameOf(t.empId)}</span>
                          <span style={{ color: '#9ca3af' }}>
                            <s>{s ? `${rosterTimeStr(s.startTime)}–${rosterTimeStr(s.endTime)}` : 'original'}</s>
                          </span>
                          <span>→</span>
                          <span className="font-semibold" style={{ color: '#6366f1' }}>
                            {to12h(t.start)}–{to12h(t.end)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Off-floor activities */}
              {Object.keys(activitiesByDest).length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#6b7280' }}>
                    📋 Off-Floor Activities
                  </div>
                  <div className="space-y-2">
                    {(Object.entries(activitiesByDest) as [ActivityKey, SlotMove[]][]).map(([dest, moves]) => {
                      const col = ACTIVITY_COLORS[dest];
                      const label = ACTIVITY_LABELS[dest];
                      // Group by staff
                      const byStaff = moves.reduce<Record<number, string[]>>((acc, m) => {
                        (acc[m.empId] ??= []).push(m.slot);
                        return acc;
                      }, {});
                      return (
                        <div key={dest}>
                          <div className="text-xs font-medium mb-1 px-2 py-0.5 rounded inline-block"
                            style={{ backgroundColor: col.bg, color: col.text }}>
                            {label}
                          </div>
                          <div className="space-y-0.5 ml-2">
                            {Object.entries(byStaff).map(([empIdStr, slots]) => {
                              const sorted = [...slots].sort();
                              return (
                                <div key={empIdStr} className="text-xs flex items-center gap-2">
                                  <span className="font-medium" style={{ color: '#374151' }}>
                                    {nameOf(parseInt(empIdStr))}
                                  </span>
                                  <span style={{ color: '#9ca3af' }}>
                                    {slotsToRanges(sorted)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Room-to-room slot moves */}
              {slotMoves.filter(m => !isActivity(m.dest) && m.dest !== '__removed__').length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#6b7280' }}>
                    ↔️ Room Moves (per slot)
                  </div>
                  <div className="space-y-1">
                    {slotMoves.filter(m => !isActivity(m.dest) && m.dest !== '__removed__').map((m, i) => {
                      const destRoom = rooms.find(r => r.id === m.dest);
                      const destLabel = destRoom?.name ?? (m.dest === '__float__' ? 'Float Pool' : m.dest);
                      return (
                        <div key={i} className="text-xs flex items-center gap-2 flex-wrap">
                          <span className="font-medium" style={{ color: '#374151' }}>{nameOf(m.empId)}</span>
                          <span className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}>
                            {to12h(m.slot)}
                          </span>
                          <span>→</span>
                          <span className="font-medium" style={{ color: '#2d5c18' }}>{destLabel}</span>
                          <span className="text-xs" style={{ color: '#9ca3af' }}>(via Ratio Check)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Section 3: Comments ── */}
        {sortedComments.length > 0 && (
          <div className="rounded-2xl border overflow-hidden shadow-sm" style={{ borderColor: '#fde68a' }}>
            <div className="px-5 py-3" style={{ backgroundColor: '#fffbeb' }}>
              <span className="text-sm font-bold" style={{ color: '#92400e' }}>💬 Ratio Check Comments</span>
              <span className="text-xs ml-2" style={{ color: '#b45309' }}>{sortedComments.length} note{sortedComments.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="bg-white divide-y" style={{ borderColor: '#fef3c7' }}>
              {sortedComments.map((c, i) => (
                <div key={i} className="px-5 py-2.5 flex items-start gap-3 text-sm">
                  <span className="text-xs font-semibold mt-0.5 shrink-0 px-2 py-0.5 rounded"
                    style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                    {to12h(c.slot)}
                  </span>
                  <span style={{ color: '#374151' }}>{c.text}</span>
                  <span className="text-xs ml-auto shrink-0" style={{ color: '#9ca3af', textTransform: 'capitalize' }}>
                    {c.session}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── No changes message ── */}
        {!hasChanges && (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: '#D0E8B8', backgroundColor: '#F5FAF3' }}>
            <div className="text-3xl mb-2">✅</div>
            <p className="text-sm font-semibold" style={{ color: '#2d5c18' }}>Running to original roster</p>
            <p className="text-xs mt-1" style={{ color: '#596570' }}>
              No day-level moves or ratio check adjustments recorded for this date.
            </p>
          </div>
        )}

      </>)}
    </div>
  );
}
