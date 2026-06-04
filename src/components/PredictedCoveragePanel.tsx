/**
 * PredictedCoveragePanel
 *
 * For future dates: overlays the actual Deputy roster on historical Owna
 * sign-in/sign-out data to predict per-slot ratio gaps and AD/float coverage.
 *
 * Data sources:
 *  - children:  Owna attendance from effectiveDate (same weekday last week),
 *               complete with sign_in / sign_out times
 *  - allRosters: tomorrow's full Deputy roster (all units, all staff)
 *  - adStaff:   AD staff extracted from support rosters (<100 approved places)
 *  - floats:    float pool staff
 *  - rooms:     centre room config (for unit IDs)
 */
import type { AttendanceChild, Room, RosteredStaff } from '../types';
import { calcRequiredStaff } from '../utils/ratioEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlotSnapshot {
  slot:       string;    // "07:00"
  children:   number;
  required:   number;
  roomStaff:  number;
  floatStaff: number;
  adStaff:    number;
  adNames:    string[];
  gapAfterAd: number;   // shortage that REMAINS after room + float + AD
  gapNoAd:    number;   // shortage without AD (just room + float)
}

interface GapPeriod {
  start:       string;
  end:         string;
  adCovers:    boolean;
  adNames:     string[];
  remaining:   number;   // gaps AD still can't fill
}

interface AdPlan {
  name:         string;
  shiftStart:   string;
  shiftEnd:     string;
  ratioPeriods: { start: string; end: string }[];
  adminPeriods: { start: string; end: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLOTS_30 = [
  '07:00','07:30','08:00','08:30','09:00','09:30',
  '10:00','10:30','11:00','11:30','12:00','12:30',
  '13:00','13:30','14:00','14:30',
  '15:00','15:30','16:00','16:30',
  '17:00','17:30','18:00',
];

function hhmm2mins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function rosterMins(t: string | number | null | undefined): number | null {
  if (!t) return null;
  const num = typeof t === 'string' ? parseInt(t, 10) : t;
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const h = parseInt(d.toLocaleString('en-AU', { hour: '2-digit', hour12: false, timeZone: 'Australia/Sydney' }));
    return h * 60 + d.getMinutes();
  }
  const parts = String(t).split(':').map(Number);
  if (parts.length >= 2 && !isNaN(parts[0])) return parts[0] * 60 + (parts[1] || 0);
  return null;
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

// Deduplicate roster entries by employeeId + startTime
function dedupeRosters(rosters: RosteredStaff[]): RosteredStaff[] {
  const seen = new Set<string>();
  return rosters.filter(r => {
    const k = `${r.employeeId}:${r.startTime}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─── Main computation ─────────────────────────────────────────────────────────

function computeTimeline(
  rooms:      Room[],
  children:   AttendanceChild[],
  allRosters: RosteredStaff[],
  floats:     RosteredStaff[],
  adStaff:    RosteredStaff[],
): SlotSnapshot[] {
  const roomUnitIds = new Set(rooms.map(r => r.deputyUnitId));
  const floatIds    = new Set(floats.map(f => f.employeeId));
  const adIds       = new Set(adStaff.map(s => s.employeeId));

  const deduped = dedupeRosters(allRosters);

  return SLOTS_30.map(slot => {
    const slotMins = hhmm2mins(slot);

    // Children present at this slot across all rooms (use historical sign_in/sign_out)
    const present = children.filter(c => {
      if (!c.sign_in) return false;
      const inM = hhmm2mins(c.sign_in.slice(0, 5));
      if (inM > slotMins) return false;
      if (c.sign_out) {
        const outM = hhmm2mins(c.sign_out.slice(0, 5));
        if (outM <= slotMins) return false;
      }
      return true;
    });

    const { required } = calcRequiredStaff(present);

    const staffAt = (roster: RosteredStaff[]) => {
      const sm = rosterMins(roster[0]?.startTime); // type-guard only
      void sm;
      return roster.filter(r => {
        const s = rosterMins(r.startTime);
        const e = rosterMins(r.endTime);
        if (s === null || e === null) return false;
        return s <= slotMins && e > slotMins;
      });
    };

    // Room staff: in a room unit, not a float and not an AD
    const roomAtSlot = staffAt(deduped.filter(r =>
      roomUnitIds.has(r.unitId) && !floatIds.has(r.employeeId) && !adIds.has(r.employeeId)
    ));

    // Floats at this slot
    const floatAtSlot = staffAt(floats);

    // AD at this slot
    const adAtSlot = staffAt(adStaff);

    const gapNoAd    = Math.max(0, required - roomAtSlot.length - floatAtSlot.length);
    const gapAfterAd = Math.max(0, gapNoAd - adAtSlot.length);

    return {
      slot,
      children:   present.length,
      required,
      roomStaff:  roomAtSlot.length,
      floatStaff: floatAtSlot.length,
      adStaff:    adAtSlot.length,
      adNames:    [...new Set(adAtSlot.map(s => s.employeeName.split(' ')[0]))],
      gapNoAd,
      gapAfterAd,
    };
  });
}

function findGapPeriods(slots: SlotSnapshot[]): GapPeriod[] {
  const gaps: GapPeriod[] = [];
  let current: { start: string; slots: SlotSnapshot[] } | null = null;

  for (const s of slots) {
    if (s.gapNoAd > 0) {
      if (!current) current = { start: s.slot, slots: [] };
      current.slots.push(s);
    } else if (current) {
      const lastSlot = current.slots[current.slots.length - 1].slot;
      const endMins  = hhmm2mins(lastSlot) + 30;
      const endHH    = String(Math.floor(endMins / 60)).padStart(2, '0');
      const endMM    = String(endMins % 60).padStart(2, '0');
      const adCovers = current.slots.every(sl => sl.adStaff >= sl.gapNoAd);
      const allAdNames = [...new Set(current.slots.flatMap(sl => sl.adNames))];
      const maxRemaining = Math.max(...current.slots.map(sl => sl.gapAfterAd));
      gaps.push({
        start: current.start, end: `${endHH}:${endMM}`,
        adCovers, adNames: allAdNames, remaining: maxRemaining,
      });
      current = null;
    }
  }
  if (current) {
    const lastSlot = current.slots[current.slots.length - 1].slot;
    const endMins  = hhmm2mins(lastSlot) + 30;
    const endHH    = String(Math.floor(endMins / 60)).padStart(2, '0');
    const endMM    = String(endMins % 60).padStart(2, '0');
    const adCovers = current.slots.every(sl => sl.adStaff >= sl.gapNoAd);
    const allAdNames = [...new Set(current.slots.flatMap(sl => sl.adNames))];
    const maxRemaining = Math.max(...current.slots.map(sl => sl.gapAfterAd));
    gaps.push({ start: current.start, end: `${endHH}:${endMM}`, adCovers, adNames: allAdNames, remaining: maxRemaining });
  }
  return gaps;
}

function buildAdPlans(adStaff: RosteredStaff[], slots: SlotSnapshot[]): AdPlan[] {
  return dedupeRosters(adStaff).map(ad => {
    const shiftStart = rosterMins(ad.startTime);
    const shiftEnd   = rosterMins(ad.endTime);
    if (shiftStart === null || shiftEnd === null) return null;

    const shiftStartHH = `${String(Math.floor(shiftStart / 60)).padStart(2,'0')}:${String(shiftStart % 60).padStart(2,'0')}`;
    const shiftEndHH   = `${String(Math.floor(shiftEnd   / 60)).padStart(2,'0')}:${String(shiftEnd   % 60).padStart(2,'0')}`;

    // For each slot during the AD's shift, determine if they're needed for ratio
    type Mode = 'ratio' | 'admin';
    const slotModes: { slot: string; mode: Mode }[] = slots
      .filter(s => {
        const m = hhmm2mins(s.slot);
        return m >= shiftStart && m < shiftEnd;
      })
      .map(s => ({
        slot: s.slot,
        mode: s.gapNoAd > 0 ? 'ratio' : 'admin',
      }));

    // Merge consecutive same-mode periods
    const ratioPeriods: { start: string; end: string }[] = [];
    const adminPeriods: { start: string; end: string }[]  = [];

    let curMode: Mode | null = null;
    let curStart: string = '';

    for (let i = 0; i < slotModes.length; i++) {
      const { slot, mode } = slotModes[i];
      if (mode !== curMode) {
        if (curMode !== null) {
          const endMins = hhmm2mins(slot);
          const endStr  = `${String(Math.floor(endMins/60)).padStart(2,'0')}:${String(endMins%60).padStart(2,'0')}`;
          (curMode === 'ratio' ? ratioPeriods : adminPeriods).push({ start: curStart, end: endStr });
        }
        curMode  = mode;
        curStart = slot;
      }
    }
    // Close last period
    if (curMode !== null && slotModes.length > 0) {
      const lastSlot = slotModes[slotModes.length - 1].slot;
      const endMins  = Math.min(hhmm2mins(lastSlot) + 30, shiftEnd);
      const endStr   = `${String(Math.floor(endMins/60)).padStart(2,'0')}:${String(endMins%60).padStart(2,'0')}`;
      (curMode === 'ratio' ? ratioPeriods : adminPeriods).push({ start: curStart, end: endStr });
    }

    return { name: ad.employeeName, shiftStart: shiftStartHH, shiftEnd: shiftEndHH, ratioPeriods, adminPeriods };
  }).filter((p): p is AdPlan => p !== null);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  rooms:        Room[];
  children:     AttendanceChild[];
  allRosters:   RosteredStaff[];
  floats:       RosteredStaff[];
  adStaff:      RosteredStaff[];
  effectiveDate: string;    // the historical date data came from
  targetDate:    string;    // the future date being planned
}

export default function PredictedCoveragePanel({ rooms, children, allRosters, floats, adStaff, effectiveDate, targetDate }: Props) {
  const slots = computeTimeline(rooms, children, allRosters, floats, adStaff);
  const activeSlots = slots.filter(s => s.children > 0 || s.roomStaff > 0);
  const gaps  = findGapPeriods(activeSlots);
  const adPlans = buildAdPlans(adStaff, activeSlots);

  const hasAnyGap = gaps.length > 0;
  const allGapsCovered = gaps.every(g => g.adCovers && g.remaining === 0);

  // Format effectiveDate nicely
  const [ey, em, ed] = effectiveDate.split('-').map(Number);
  const histLabel = new Date(ey, em - 1, ed).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden mb-6" style={{ borderColor: '#c7d2fe' }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center gap-3" style={{ backgroundColor: '#eef2ff' }}>
        <span className="text-sm font-bold" style={{ color: '#3730a3' }}>📅 Predicted Coverage</span>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#c7d2fe', color: '#3730a3' }}>
          Using {histLabel} attendance · {targetDate} roster
        </span>
        {hasAnyGap && !allGapsCovered && (
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold ml-auto" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
            ⚠️ Uncovered gaps
          </span>
        )}
        {hasAnyGap && allGapsCovered && (
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold ml-auto" style={{ backgroundColor: '#dcfce7', color: '#16a34a' }}>
            ✅ All gaps covered with AD
          </span>
        )}
        {!hasAnyGap && (
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold ml-auto" style={{ backgroundColor: '#dcfce7', color: '#16a34a' }}>
            ✅ No ratio gaps predicted
          </span>
        )}
      </div>

      <div className="bg-white px-5 py-4 space-y-4">
        {/* ── Slot timeline ── */}
        {activeSlots.length > 0 && (
          <div className="overflow-x-auto">
            <table style={{ fontSize: '10px', borderCollapse: 'collapse', minWidth: '600px', width: '100%' }}>
              <thead>
                <tr>
                  <td style={{ padding: '2px 6px', fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>Time</td>
                  {activeSlots.map(s => (
                    <td key={s.slot} style={{ padding: '2px 4px', textAlign: 'center', color: '#6b7280', whiteSpace: 'nowrap' }}>
                      {to12h(s.slot)}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Children row */}
                <tr>
                  <td style={{ padding: '2px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>👶 Children</td>
                  {activeSlots.map(s => (
                    <td key={s.slot} style={{ padding: '2px 4px', textAlign: 'center', fontWeight: 600, color: '#374151' }}>
                      {s.children || '—'}
                    </td>
                  ))}
                </tr>
                {/* Required row */}
                <tr>
                  <td style={{ padding: '2px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>📋 Needed</td>
                  {activeSlots.map(s => (
                    <td key={s.slot} style={{ padding: '2px 4px', textAlign: 'center', color: '#374151' }}>
                      {s.required || '—'}
                    </td>
                  ))}
                </tr>
                {/* Room staff row */}
                <tr>
                  <td style={{ padding: '2px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>🧑‍🏫 Room staff</td>
                  {activeSlots.map(s => (
                    <td key={s.slot} style={{ padding: '2px 4px', textAlign: 'center', color: '#374151' }}>
                      {s.roomStaff || '—'}
                    </td>
                  ))}
                </tr>
                {/* Status row */}
                <tr>
                  <td style={{ padding: '2px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>Status</td>
                  {activeSlots.map(s => {
                    const bg =
                      s.gapAfterAd > 0   ? '#fee2e2' :
                      s.gapNoAd > 0      ? '#fef3c7' :
                      s.children === 0   ? '#f3f4f6' :
                                           '#dcfce7';
                    const icon =
                      s.gapAfterAd > 0   ? '🔴' :
                      s.gapNoAd > 0      ? '🟡' :
                      s.children === 0   ? '⬜' :
                                           '🟢';
                    const title =
                      s.gapAfterAd > 0   ? `Short ${s.gapAfterAd} even with AD` :
                      s.gapNoAd > 0      ? `Gap of ${s.gapNoAd} — AD covers` :
                                           'Compliant';
                    return (
                      <td key={s.slot} title={title}
                        style={{ padding: '3px 4px', textAlign: 'center', backgroundColor: bg, borderRadius: '2px' }}>
                        {icon}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── Gap summary ── */}
        {gaps.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#6b7280' }}>Predicted Gaps</div>
            {gaps.map((g, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl px-3 py-2"
                style={{ backgroundColor: g.remaining > 0 ? '#fef2f2' : '#fefce8', border: `1px solid ${g.remaining > 0 ? '#fca5a5' : '#fde68a'}` }}>
                <span className="text-base mt-0.5">{g.remaining > 0 ? '⚠️' : '🟡'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold" style={{ color: '#1f2937' }}>
                    {to12h(g.start)} – {to12h(g.end)}
                  </div>
                  {g.adCovers && g.remaining === 0 ? (
                    <div className="text-xs mt-0.5" style={{ color: '#92400e' }}>
                      Ratio gap covered by <strong>{g.adNames.join(', ')}</strong> (AD)
                    </div>
                  ) : g.remaining > 0 ? (
                    <div className="text-xs mt-0.5" style={{ color: '#dc2626' }}>
                      Still {g.remaining} short even with AD — consider a casual or float
                    </div>
                  ) : (
                    <div className="text-xs mt-0.5" style={{ color: '#92400e' }}>
                      Floats cover this gap
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── AD suggested day plan ── */}
        {adPlans.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#6b7280' }}>Suggested AD Plan</div>
            {adPlans.map((plan, i) => (
              <div key={i} className="rounded-xl border px-4 py-3" style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold" style={{ color: '#92400e' }}>👔 {plan.name}</span>
                  <span className="text-xs" style={{ color: '#b45309' }}>{to12h(plan.shiftStart)} – {to12h(plan.shiftEnd)}</span>
                </div>
                <div className="space-y-1">
                  {plan.ratioPeriods.map((p, j) => (
                    <div key={`r${j}`} className="flex items-center gap-2 text-xs">
                      <span className="font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>Ratio cover</span>
                      <span style={{ color: '#374151' }}>{to12h(p.start)} – {to12h(p.end)}</span>
                    </div>
                  ))}
                  {plan.adminPeriods.map((p, j) => (
                    <div key={`a${j}`} className="flex items-center gap-2 text-xs">
                      <span className="font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>AD duties</span>
                      <span style={{ color: '#374151' }}>{to12h(p.start)} – {to12h(p.end)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeSlots.length === 0 && (
          <p className="text-sm italic text-center py-4" style={{ color: '#9ca3af' }}>
            No historical attendance data found for {histLabel} — try viewing the Ratio Check for per-slot details.
          </p>
        )}
      </div>
    </div>
  );
}
