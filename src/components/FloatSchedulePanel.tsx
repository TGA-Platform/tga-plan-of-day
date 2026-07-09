/**
 * FloatSchedulePanel
 * Slide-in drawer for planning a floater's movement schedule for the day.
 *
 * Auto-populates:
 *  – Start-of-shift block: room with biggest ratio gap during the first 2hrs
 *  – End-of-shift block: room with biggest ratio gap during the last 2hrs
 *  – Optional midday break placeholder
 *
 * Each manual break block captures:
 *  – Time range
 *  – Room the floater covers in
 *  – Staff member they are covering + that person's room
 */
import { useState, useEffect } from 'react';
import type { AttendanceChild, Room, RoomRatioStatus, RosteredStaff, FloatStaff } from '../types';
import { toMins, minsToAmPm, minsToHHMM, hhmmToMins } from '../utils/timeUtils';
import { getUser } from '../auth';
import { loadCentreRules, breakLabelForTime, getBreakWindow } from '../utils/centreRules';
import { enqueueSave } from '../utils/syncQueue';
import type { CentreRule } from '../utils/centreRules';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type BlockType = 'start' | 'end' | 'break';

export type CoverType = 'lunch' | 'programming' | 'ratio' | 'cleaning' | 'own-lunch';

/** Infer cover type from notes text */
function inferCoverType(notes: string): CoverType | undefined {
  const n = notes.toLowerCase();
  if (n === 'own lunch break' || n.includes('own lunch') || n.includes('own break')) return 'own-lunch';
  if (n.includes('clean')) return 'cleaning';
  if (n.includes('ratio') || n.includes('short') || n.includes('shortage')) return 'ratio';
  if (n.includes('programming') || n.includes('program')) return 'programming';
  if (n.includes('lunch') || n.includes('break') || n.includes('tea') || n.includes('meal')) return 'lunch';
  return undefined;
}

export interface FloatBlock {
  id:                     string;
  type:                   BlockType;
  startTime:              string;   // HH:MM
  endTime:                string;   // HH:MM
  roomId:                 string;
  roomName:               string;
  coveringEmployeeId:     number | null;
  coveringEmployeeName:   string;
  coveringEmployeeRoom:   string;
  coverType?:             CoverType;  // 'lunch' | 'programming' â€” for Reg 151 reporting
  notes:                  string;
}

export interface FloatSchedule {
  employeeId:   number;
  employeeName: string;
  shiftStart:   string;
  shiftEnd:     string;
  blocks:       FloatBlock[];
}

interface Props {
  float:        FloatStaff;
  centreId:     string;
  date:         string;
  rooms:        Room[];
  roomStatuses: RoomRatioStatus[];
  children:     AttendanceChild[];
  onClose:      () => void;
  onSaved:      (schedule: FloatSchedule) => void;
  historicalDate?: string; // if set, suggestions are based on this past date
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

/** Find the room with the biggest ACTUAL ratio shortfall (shortage > 0) during a time window.
 *  Returns null when all rooms already meet ratio — in that case use programming cover instead. */
function suggestRoom(
  startMins: number,
  endMins:   number,
  children:  AttendanceChild[],
  statuses:  RoomRatioStatus[],
): { roomId: string; roomName: string; shortage: number } | null {
  const counts: Record<string, number> = {};
  for (const c of children) {
    if (!c.sign_in) continue;
    const signIn  = toMins(c.sign_in);
    const signOut = c.sign_out ? toMins(c.sign_out) : 22 * 60;
    if (signIn === null) continue;
    if (signIn < endMins && (signOut === null || signOut > startMins)) {
      counts[c.room] = (counts[c.room] ?? 0) + 1;
    }
  }

  let bestId: string | null = null, bestName = '', bestShortage = 0; // threshold: must be > 0
  for (const rs of statuses) {
    const owna = (rs.room.ownaRoomName ?? rs.room.name).toLowerCase();
    const kidsInWindow = Object.entries(counts)
      .filter(([r]) => r.toLowerCase().includes(owna))
      .reduce((s, [, n]) => s + n, 0);
    const needed   = Math.ceil(kidsInWindow / rs.room.ratio);
    const shortage = needed - rs.staffCount;
    if (shortage > bestShortage) {
      bestShortage = shortage;
      bestId   = rs.room.id;
      bestName = rs.room.name;
    }
  }
  // Only return a suggestion when there is a genuine shortfall
  return bestId ? { roomId: bestId, roomName: bestName, shortage: bestShortage } : null;
}

/** Convert HH:MM to minutes since midnight */
function hhmmMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h||0)*60+(m||0);
}

/**
 * Build a complete, contiguous schedule covering the floater's entire shift.
 *
 * Structure:
 *  [start ratio] → [break 1] → [ratio gap] → [break 2] → … → [end ratio]
 *
 * Each break slot is assigned to a specific staff member who needs a break,
 * chosen by matching their room's ratio need at that time.
 */
function buildInitialSchedule(
  float:           FloatStaff,
  _rooms:          Room[],
  statuses:        RoomRatioStatus[],
  children:        AttendanceChild[],
  centreId:        string,
  rules:           CentreRule[],
  alreadyCovered:  Set<number> = new Set(), // employee IDs already covered by other floats
): FloatBlock[] {
  const shiftStart = toMins(float.startTime);
  const shiftEnd   = toMins(float.endTime);
  if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) return [];

  const BREAK_DURATION = 30;

  // Lunch window anchors â€” breaks are ONLY scheduled within this window.
  // Outside it: check ratio â†’ ratio cover or programming cover.
  const lunchWin        = getBreakWindow('lunch', centreId, rules);
  const breakDuration   = lunchWin?.durationMins ?? BREAK_DURATION;
  const rawLunchStart   = lunchWin ? hhmmMins(lunchWin.start) : shiftStart + 90;
  const rawLunchEnd     = lunchWin ? hhmmMins(lunchWin.end)   : shiftEnd - 30;
  const lunchWindowStart = Math.max(shiftStart, rawLunchStart);
  const lunchWindowEnd   = Math.min(shiftEnd,   rawLunchEnd);
  const hasLunchWindow   = lunchWindowEnd > lunchWindowStart + breakDuration;

  // ── Eligible staff: room staff whose shift overlaps the floater’s ─────────
  type EligibleStaff = {
    employeeId: number; employeeName: string;
    roomId: string; roomName: string;
    shiftStart: number; shiftEnd: number;
  };
  const eligible: EligibleStaff[] = [];
  for (const rs of statuses) {
    for (const s of rs.rosteredStaff) {
      const ss = toMins(s.startTime), se = toMins(s.endTime);
      if (ss === null || se === null) continue;
      if (ss < shiftEnd && se > shiftStart) {
        eligible.push({
          employeeId:   s.employeeId,
          employeeName: s.employeeName,
          roomId:       rs.room.id,
          roomName:     rs.room.name,
          shiftStart:   ss,
          shiftEnd:     se,
        });
      }
    }
  }

  // Sort eligible staff: highest ratio room first
  const sorted = [...eligible].sort((a, b) => {
    const ra = statuses.find(rs => rs.room.id === a.roomId);
    const rb = statuses.find(rs => rs.room.id === b.roomId);
    return (rb?.shortage ?? 0) - (ra?.shortage ?? 0);
  });

  // Exclude staff already covered by other floats at this centre
  const availableTocover = sorted.filter(s => !alreadyCovered.has(s.employeeId));

  // Break slots: ONLY within the lunch window, stacked back-to-back
  const maxBreaksInWindow = hasLunchWindow
    ? Math.floor((lunchWindowEnd - lunchWindowStart) / breakDuration)
    : 0;
  const numBreaks = Math.min(maxBreaksInWindow, availableTocover.length);
  const breakSlots = availableTocover.slice(0, numBreaks).map((staff, i) => ({
    staff, breakStart: lunchWindowStart + i * breakDuration,
  })).filter(s => s.breakStart + breakDuration <= lunchWindowEnd);

  // Block builders
  const blocks: FloatBlock[] = [];
  let cursor = shiftStart;
  const usedForProgramming = new Set<number>();

  /**
   * Scan rom->	o in 15-min steps and build granular blocks:
   * - Genuine ratio shortage  -> ratio cover for that room
   * - Ratio satisfied         -> programming cover for next available staff member
   * Consecutive steps with the same assignment are merged into one block.
   */
  function buildSegment(from: number, to: number, allowRatio = true): void {
    if (from >= to) return;
    const STEP = 15;
    let cur = from;

    while (cur < to) {
      // Check for ratio shortage at this point (disabled inside the lunch window so
      // lunch covers are not auto-converted to ratio covers)
      const shortRoom = allowRatio ? suggestRoom(cur, Math.min(cur + STEP, to), children, statuses) : null;

      if (shortRoom) {
        // Extend ratio block while the same room is still short
        let ratioEnd = cur + STEP;
        while (ratioEnd < to) {
          const next = suggestRoom(ratioEnd, Math.min(ratioEnd + STEP, to), children, statuses);
          if (!next || next.roomId !== shortRoom.roomId) break;
          ratioEnd += STEP;
        }
        ratioEnd = Math.min(ratioEnd, to);
        blocks.push({
          id: uid(), type: 'break',
          startTime: minsToHHMM(cur), endTime: minsToHHMM(ratioEnd),
          roomId: shortRoom.roomId, roomName: shortRoom.roomName,
          coveringEmployeeId: null, coveringEmployeeName: '', coveringEmployeeRoom: '',
          coverType: 'ratio' as CoverType,
          notes: 'Ratio support',
        });
        cur = ratioEnd;
      } else {
        // No ratio need â€” programming cover for the next available staff member
        const progStaff = sorted.find(
          s => !usedForProgramming.has(s.employeeId) &&
               !alreadyCovered.has(s.employeeId) &&
               s.shiftStart < to && s.shiftEnd > cur
        );
        if (progStaff) {
          // Cover this person until ratio is needed again, their shift ends, or segment ends
          let progEnd = cur + STEP;
          while (progEnd < to && progEnd < progStaff.shiftEnd) {
            const nextShort = suggestRoom(progEnd, Math.min(progEnd + STEP, to), children, statuses);
            if (nextShort) break;
            progEnd += STEP;
          }
          progEnd = Math.min(progEnd, to, progStaff.shiftEnd);
          blocks.push({
            id: uid(), type: 'break',
            startTime: minsToHHMM(cur), endTime: minsToHHMM(progEnd),
            roomId: progStaff.roomId, roomName: progStaff.roomName,
            coveringEmployeeId:   progStaff.employeeId,
            coveringEmployeeName: progStaff.employeeName,
            coveringEmployeeRoom: progStaff.roomName,
            coverType: 'programming', notes: 'Programming cover',
          });
          usedForProgramming.add(progStaff.employeeId);
          cur = progEnd;
        } else {
          // No staff left to cover â€” mark as available
          blocks.push({
            id: uid(), type: 'break',
            startTime: minsToHHMM(cur), endTime: minsToHHMM(to),
            roomId: statuses[0]?.room.id ?? '', roomName: statuses[0]?.room.name ?? '',
            coveringEmployeeId: null, coveringEmployeeName: '', coveringEmployeeRoom: '',
            notes: 'Available',
          });
          cur = to;
        }
      }
    }
  }

  // 1. Pre-lunch: shift start -> lunch window start (dynamic ratio/programming scan)
  if (hasLunchWindow && cursor < lunchWindowStart) {
    buildSegment(cursor, lunchWindowStart);
    cursor = lunchWindowStart;
  }

  // 2. Lunch window: sequential break covers + dynamic gaps between them
  for (let i = 0; i < breakSlots.length; i++) {
    const { staff, breakStart } = breakSlots[i];
    const breakEnd = Math.min(breakStart + breakDuration, lunchWindowEnd);
    // Dynamic gap before this break (inside the lunch window) — no auto ratio covers
    if (cursor < breakStart - 1) {
      buildSegment(cursor, breakStart, false);
    }
    blocks.push({
      id: uid(), type: 'break',
      startTime:            minsToHHMM(breakStart),
      endTime:              minsToHHMM(breakEnd),
      roomId:               staff.roomId,
      roomName:             staff.roomName,
      coveringEmployeeId:   staff.employeeId,
      coveringEmployeeName: staff.employeeName,
      coveringEmployeeRoom: staff.roomName,
      coverType:            'lunch',
      notes:                breakLabelForTime(minsToHHMM(breakStart), centreId, rules),
    });
    cursor = breakEnd;
  }


  // Float's own lunch break — scheduled right after covering all room staff,
  // within the lunch window if possible, otherwise as the first post-lunch block.
  if (breakDuration > 0 && cursor + breakDuration <= shiftEnd) {
    blocks.push({
      id: uid(), type: 'break',
      startTime:            minsToHHMM(cursor),
      endTime:              minsToHHMM(cursor + breakDuration),
      roomId:               '',
      roomName:             '',
      coveringEmployeeId:   null,
      coveringEmployeeName: '',
      coveringEmployeeRoom: '',
      coverType:            'own-lunch' as CoverType,
      notes:                'Own lunch break',
    });
    cursor += breakDuration;
  }

  // Dynamic gap remaining inside lunch window after last break — no auto ratio covers
  if (hasLunchWindow && cursor < lunchWindowEnd - 1) {
    buildSegment(cursor, lunchWindowEnd, false);
    cursor = lunchWindowEnd;
  } else if (hasLunchWindow && cursor < lunchWindowEnd) {
    cursor = lunchWindowEnd;
  }

  // 3. Post-lunch: lunch window end -> shift end (dynamic ratio/programming scan)
  if (cursor < shiftEnd) {
    buildSegment(cursor, shiftEnd);
  }

  return blocks;
}

// ─── Block row ────────────────────────────────────────────────────────────────

function BlockRow({
  block,
  rooms,
  allStaff,
  staffRoomMap,
  onChange,
  onRemove,
}: {
  block:        FloatBlock;
  rooms:        Room[];
  allStaff:     RosteredStaff[];
  staffRoomMap: Map<number, string>;
  onChange:     (updated: FloatBlock) => void;
  onRemove:     () => void;
}) {
  const coverTypeLabel: Record<string, string> = {
    lunch:        '🍽 Lunch / break cover',
    programming:  '📚 Programming cover',
    ratio:        '🔢 Ratio cover',
    cleaning:     '🧹 Cleaning duties',
    'own-lunch':  '😋 Own lunch break',
  };
  const effectiveCoverType = block.coverType ?? inferCoverType(block.notes);
  const isCleaning = effectiveCoverType === 'cleaning';
  const isOwnLunch = effectiveCoverType === 'own-lunch';
  const typeLabel: Record<BlockType, string> = {
    start: '🌅 Start of shift',
    end:   '🌆 End of shift',
    break: effectiveCoverType ? coverTypeLabel[effectiveCoverType] : 'Break cover',
  };
  const typeColour: Record<BlockType, string> = {
    start: '#E2F1DA',
    end:   '#FDEACC',
    break: '#dbeafe',
  };

  function handleStaffChange(empId: number) {
    const staff = allStaff.find(s => s.employeeId === empId);
    const room  = staffRoomMap.get(empId) ?? '';
    onChange({
      ...block,
      coveringEmployeeId:   empId,
      coveringEmployeeName: staff?.employeeName ?? '',
      coveringEmployeeRoom: room,
    });
  }

  function handleRoomChange(roomId: string) {
    if (roomId === 'family_grouping') {
      onChange({ ...block, roomId: 'family_grouping', roomName: 'Family Grouping' });
      return;
    }
    const room = rooms.find(r => r.id === roomId);
    onChange({ ...block, roomId, roomName: room?.name ?? roomId });
  }

  const inputCls = 'w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none';
  const inputStyle = { borderColor: '#D0E8B8', color: '#050505' };

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
      {/* Block header */}
      <div className="px-3 py-2 flex items-center justify-between"
        style={{ backgroundColor: typeColour[block.type] }}>
        <span className="text-xs font-semibold" style={{ color: '#050505' }}>
          {typeLabel[block.type]}
        </span>
        {block.type === 'break' && (
          <button onClick={onRemove} className="text-xs opacity-50 hover:opacity-100"
            style={{ color: '#dc2626' }}>✕ Remove</button>
        )}
      </div>

      <div className="p-3 space-y-2" style={{ backgroundColor: 'white' }}>
        {/* Time range */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-xs mb-1 block" style={{ color: '#596570' }}>From</label>
            <input type="time" value={block.startTime}
              onChange={e => onChange({ ...block, startTime: e.target.value })}
              className={inputCls} style={inputStyle} />
          </div>
          <div className="flex-1">
            <label className="text-xs mb-1 block" style={{ color: '#596570' }}>To</label>
            <input type="time" value={block.endTime}
              onChange={e => onChange({ ...block, endTime: e.target.value })}
              className={inputCls} style={inputStyle} />
          </div>
        </div>

        {/* Room covering in — hidden for cleaning/own-lunch */}
        {!isCleaning && !isOwnLunch && (
          <div>
            <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Floater in room</label>
            <select value={block.roomId}
              onChange={e => handleRoomChange(e.target.value)}
              className={inputCls} style={inputStyle}>
              <option value="">— select room —</option>
              <option value="family_grouping">🏫 Family Grouping</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Staff covering — hidden for cleaning/own-lunch */}
        {block.type === 'break' && !isCleaning && !isOwnLunch && (
          <>
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Covering staff member</label>
              <select
                value={block.coveringEmployeeId ?? ''}
                onChange={e => handleStaffChange(Number(e.target.value))}
                className={inputCls} style={inputStyle}>
                <option value="">— select staff —</option>
                {allStaff.map(s => (
                  <option key={s.employeeId} value={s.employeeId}>
                    {s.employeeName}
                  </option>
                ))}
              </select>
            </div>
            {block.coveringEmployeeName && (
              <div className="text-xs px-2 py-1.5 rounded-lg"
                style={{ backgroundColor: '#F5FAF3', color: '#5a9228' }}>
                📍 {block.coveringEmployeeName} is in <strong>{block.coveringEmployeeRoom || 'unknown room'}</strong>
              </div>
            )}
          </>
        )}

        {/* Cover type — required for Reg 151 reporting */}
        {block.type === 'break' && (
          <div>
            <label className="text-xs mb-1 block font-medium" style={{ color: '#596570' }}>Cover type</label>
            <select
              value={block.coverType ?? inferCoverType(block.notes) ?? ''}
              onChange={e => onChange({ ...block, coverType: (e.target.value as CoverType) || undefined })}
              className={inputCls} style={inputStyle}>
              <option value="">— select type —</option>
              <option value="lunch">🍽 Lunch / break cover</option>
              <option value="programming">📚 Programming cover</option>
              <option value="ratio">🔢 Ratio cover</option>
              <option value="cleaning">🧹 Cleaning duties</option>
              <option value="own-lunch">😋 Own lunch break</option>
            </select>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Notes (optional)</label>
          <input type="text" value={block.notes}
            onChange={e => {
              const newNotes = e.target.value;
              const inferred = inferCoverType(newNotes);
              onChange({
                ...block,
                notes: newNotes,
                // Auto-select cover type from notes so they stay in sync.
                // e.g. "Lunch break cover" notes must default to lunch cover type.
                ...(inferred ? { coverType: inferred } : {}),
              });
            }}
            placeholder="e.g. additional details"
            className={inputCls} style={inputStyle} />
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function FloatSchedulePanel({
  float, centreId, date, rooms, roomStatuses, children, onClose, onSaved, historicalDate,
}: Props) {
  const user        = getUser();
  const shiftStartM = toMins(float.startTime);
  const shiftEndM   = toMins(float.endTime);
  const shiftLabel  = shiftStartM !== null && shiftEndM !== null
    ? `${minsToAmPm(shiftStartM)} – ${minsToAmPm(shiftEndM)}`
    : '';

  const [blocks, setBlocks]   = useState<FloatBlock[]>([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [loading, setLoading] = useState(true);
  const [rules, setRules]     = useState<CentreRule[]>([]);

  // All room staff for the covering dropdown
  const allRoomStaff = roomStatuses.flatMap(rs => rs.rosteredStaff);

  // Map employeeId → room name
  const staffRoomMap = new Map<number, string>();
  for (const rs of roomStatuses) {
    for (const s of rs.rosteredStaff) {
      staffRoomMap.set(s.employeeId, rs.room.name);
    }
  }

  const lsKey = `tga_pod_float:${centreId}:${date}:${float.employeeId}`;

  // Load saved schedule: Supabase → localStorage → auto-populate
  useEffect(() => {
    async function loadSchedule() {
      setLoading(true);
      const centreRules = await loadCentreRules();
      setRules(centreRules);

      // 1. Try Supabase (authoritative)
      try {
        const r = await fetch(
          `/api/float-schedules?centre=${encodeURIComponent(centreId)}&date=${date}&employee=${float.employeeId}`
        );
        if (r.ok) {
          const rows = await r.json();
          if (rows.length > 0 && rows[0].schedule?.length > 0) {
            setBlocks(rows[0].schedule);
            setSaved(true);
            setLoading(false);
            return;
          }
        }
      } catch { /* offline or table not created yet */ }

      // 2. Fall back to localStorage (works even without Supabase table)
      try {
        const lsRaw = localStorage.getItem(lsKey);
        if (lsRaw) {
          const schedule = JSON.parse(lsRaw);
          if (schedule?.blocks?.length > 0) {
            setBlocks(schedule.blocks);
            setSaved(true);
            setLoading(false);
            return;
          }
        }
      } catch { /* ignore */ }

      // 3. No saved schedule — auto-populate.
      // Load other floats' saved schedules to avoid covering the same people twice.
      const alreadyCovered = new Set<number>();
      try {
        const othersRes = await fetch(
          `/api/float-schedules?centre=${encodeURIComponent(centreId)}&date=${date}`
        );
        if (othersRes.ok) {
          const allRows = await othersRes.json();
          for (const row of allRows) {
            if (row.employee_id === float.employeeId) continue; // skip self
            for (const block of (row.schedule ?? [])) {
              if (block.type === 'break' && block.coveringEmployeeId) {
                alreadyCovered.add(block.coveringEmployeeId);
              }
            }
          }
        }
      } catch { /* offline â€” proceed without dedup */ }

            const generatedBlocks = buildInitialSchedule(float, rooms, roomStatuses, children, centreId, centreRules, alreadyCovered);
      setBlocks(generatedBlocks);
      // Auto-save immediately so other floats' Plan Day sees this schedule
      try {
        await fetch('/api/float-schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ centre_id: centreId, date, employee_id: float.employeeId, employee_name: float.employeeName, schedule: generatedBlocks }),
        });
        setSaved(true);
      } catch { /* non-critical */ }
      setLoading(false);
    }
    loadSchedule();
  }, [float.employeeId]); // eslint-disable-line

  function updateBlock(id: string, updated: FloatBlock) {
    setBlocks(prev => prev.map(b => b.id === id ? updated : b));
    setSaved(false);
  }

  function removeBlock(id: string) {
    setBlocks(prev => prev.filter(b => b.id !== id));
    setSaved(false);
  }

  function addBreakBlock() {
    const lastBlock = blocks[blocks.length - 2] ?? blocks[blocks.length - 1];
    const prevEnd   = lastBlock ? hhmmToMins(lastBlock.endTime) : (shiftStartM ?? 8 * 60) + 120;
    const start     = prevEnd;
    const end       = Math.min(start + 90, shiftEndM ?? 18 * 60);
    setBlocks(prev => {
      // Insert before the 'end' block if one exists
      const endIdx = prev.findIndex(b => b.type === 'end');
      const newBlock: FloatBlock = {
        id: uid(), type: 'break',
        startTime:  minsToHHMM(start),
        endTime:    minsToHHMM(end),
        roomId: '', roomName: '',
        coveringEmployeeId: null, coveringEmployeeName: '', coveringEmployeeRoom: '',
        notes: '',
      };
      if (endIdx >= 0) {
        const next = [...prev];
        next.splice(endIdx, 0, newBlock);
        return next;
      }
      return [...prev, newBlock];
    });
    setSaved(false);
  }

  /** Append an extra slot at the very end of the schedule (after all existing blocks). */
  function addExtraBlock() {
    const lastBlock = blocks[blocks.length - 1];
    const prevEnd   = lastBlock ? hhmmToMins(lastBlock.endTime) : (shiftStartM ?? 8 * 60);
    const start     = prevEnd;
    const end       = Math.min(start + 60, shiftEndM ?? 18 * 60);
    setBlocks(prev => [
      ...prev,
      {
        id: uid(), type: 'break',
        startTime:  minsToHHMM(start),
        endTime:    minsToHHMM(end),
        roomId: '', roomName: '',
        coveringEmployeeId: null, coveringEmployeeName: '', coveringEmployeeRoom: '',
        notes: '',
      } as FloatBlock,
    ]);
    setSaved(false);
  }

  async function handleRegenerate() {
    setLoading(true);
    setSaved(false);
    try {
      // Reload centre rules fresh
      let freshRules = rules;
      try { freshRules = await loadCentreRules(); setRules(freshRules); } catch { /* use existing */ }

      // Load other floats' saved schedules to avoid covering the same people
      const alreadyCovered = new Set<number>();
      try {
        const othersRes = await fetch(
          `/api/float-schedules?centre=${encodeURIComponent(centreId)}&date=${date}`
        );
        if (othersRes.ok) {
          const allRows = await othersRes.json();
          for (const row of allRows) {
            if (row.employee_id === float.employeeId) continue;
            for (const block of (row.schedule ?? [])) {
              if (block.type === 'break' && block.coveringEmployeeId) {
                alreadyCovered.add(block.coveringEmployeeId);
              }
            }
          }
        }
      } catch { /* proceed without cross-check */ }

      // Generate new schedule
      const regenBlocks = buildInitialSchedule(float, rooms, roomStatuses, children, centreId, freshRules, alreadyCovered);

      // Preserve any coverType overrides set by the ratio check panel.
      // Ratio check is always the source of truth — if it has assigned a staff member
      // to ratio or programming cover, that assignment must not be overridden on regenerate.
      const existingBlocks = blocks; // current blocks (loaded from Supabase, may have ratio-check coverType)
      const mergedBlocks = regenBlocks.map(newBlock => {
        if (newBlock.type !== 'break') return newBlock;
        // Find a matching existing break block for the same time window
        const existingMatch = existingBlocks.find(
          b => b.type === 'break' && b.startTime === newBlock.startTime && b.endTime === newBlock.endTime
        );
        // If existing block has a coverType set (from ratio check), preserve it
        if (existingMatch?.coverType) {
          return { ...newBlock, coverType: existingMatch.coverType };
        }
        return newBlock;
      });

      setBlocks(mergedBlocks);

      // Auto-save so other floats see this
      try {
        await fetch('/api/float-schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ centre_id: centreId, date, employee_id: float.employeeId, employee_name: float.employeeName, schedule: mergedBlocks }),
        });
        setSaved(true);
      } catch { setSaved(false); }
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    const schedule: FloatSchedule = {
      employeeId:   float.employeeId,
      employeeName: float.employeeName,
      shiftStart:   minsToHHMM(shiftStartM ?? 0),
      shiftEnd:     minsToHHMM(shiftEndM ?? 0),
      blocks,
    };

    // Save to localStorage immediately (works even without Supabase table)
    localStorage.setItem(lsKey, JSON.stringify(schedule));

    // Supabase (with offline queue fallback)
    const saveResult = await enqueueSave('/api/float-schedules', {
      centre_id:     centreId,
      date,
      employee_id:   float.employeeId,
      employee_name: float.employeeName,
      schedule:      blocks,
      saved_by:      user?.email ?? null,
    });
    if (saveResult === 'queued') {
      console.warn('[FloatSchedule] Supabase unavailable — save queued for retry');
    }

    // Also sync break-cover info into lunch_schedules so LunchBreakPanel stays in sync
    try {
      const breakBlocks = blocks.filter(b => b.type === 'break' && b.coveringEmployeeId);
      if (breakBlocks.length > 0) {
        // Load current lunch schedule for this centre+date
        const lsRes = await fetch(
          `/api/lunch-schedules?centre=${encodeURIComponent(centreId)}&date=${date}`
        );
        const currentSchedule: any[] = lsRes.ok ? await lsRes.json() : [];
        const existing: any[] = currentSchedule[0]?.schedule ?? [];

        // Merge: update coveredBy for staff members this float is covering
        const updated = [...existing];
        for (const block of breakBlocks) {
          const idx = updated.findIndex(e => e.employeeId === block.coveringEmployeeId);
          const patch = {
            employeeId:   block.coveringEmployeeId,
            employeeName: block.coveringEmployeeName,
            roomName:     block.coveringEmployeeRoom,
            roomId:       block.roomId,
            lunchStart:   block.startTime,
            lunchEnd:     block.endTime,
            coveredBy:    { employeeId: float.employeeId, employeeName: float.employeeName, type: 'float' },
            autoGenerated: false,
            needsCover:   true,
          };
          if (idx >= 0) updated[idx] = { ...updated[idx], ...patch };
          else          updated.push(patch);
        }

        await fetch('/api/lunch-schedules', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ centre_id: centreId, date, schedule: updated }),
        });
        // Bust localStorage cache so LunchBreakPanel re-reads (must match STORAGE_KEY in LunchBreakPanel)
        localStorage.removeItem(`tga_lunch:${centreId}:${date}`);
      }
    } catch { /* non-critical */ }

    setSaving(false);
    setSaved(true);
    onSaved(schedule);
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col shadow-2xl"
        style={{ width: 'min(420px, 100vw)', backgroundColor: '#F5FAF3' }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-start justify-between"
          style={{ backgroundColor: 'white', borderColor: '#E2F1DA' }}>
          <div>
            <div className="font-bold text-base" style={{ color: '#050505' }}>
              {float.employeeName}
            </div>
            <div className="text-xs mt-0.5" style={{ color: '#596570' }}>
              Float · {shiftLabel}
            </div>
          </div>
          <button onClick={onClose}
            className="text-lg leading-none ml-4 mt-0.5 opacity-40 hover:opacity-100"
            style={{ color: '#050505' }}>✕</button>
        </div>

        {/* Scroll area */}
        {historicalDate && (
          <div style={{ margin: '8px 16px 0', padding: '6px 10px', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '11px', color: '#92400e' }}>
            Suggestions predicted from {historicalDate} (same day last week)
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading ? (
            <div className="text-sm italic text-center py-8" style={{ color: '#596570' }}>
              Loading schedule…
            </div>
          ) : (
            <>
              {blocks.map((block, _i) => (
                <div key={block.id}>
                  <BlockRow
                    block={block}
                    rooms={rooms}
                    allStaff={allRoomStaff}
                    staffRoomMap={staffRoomMap}
                    onChange={updated => updateBlock(block.id, updated)}
                    onRemove={() => removeBlock(block.id)}
                  />
                  {/* Add break slot button between start and end blocks */}
                  {block.type === 'start' && (
                    <button
                      onClick={addBreakBlock}
                      className="w-full mt-2 py-1.5 rounded-lg border border-dashed text-xs font-medium transition-colors hover:bg-white"
                      style={{ borderColor: '#2d5c18', color: '#5a9228' }}
                    >
                      + Add break cover slot
                    </button>
                  )}
                </div>
              ))}

              {blocks.length === 0 && (
                <div className="text-sm italic text-center py-6" style={{ color: '#596570' }}>
                  No schedule yet — add a break cover slot above
                </div>
              )}

              {/* Add additional slot at the end */}
              <button
                onClick={addExtraBlock}
                className="w-full mt-3 py-2 rounded-xl border border-dashed text-xs font-medium transition-colors hover:bg-white flex items-center justify-center gap-1.5"
                style={{ borderColor: '#a3a3a3', color: '#6b7280' }}
              >
                <span style={{ fontSize: 16 }}>+</span> Add additional area
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-4 border-t flex items-center gap-3"
          style={{ backgroundColor: 'white', borderColor: '#E2F1DA' }}>
          <button
            onClick={handleRegenerate}
            disabled={saving || loading}
            className="px-3 py-2.5 rounded-xl font-semibold text-sm border disabled:opacity-50"
            style={{ borderColor: '#c4b5fd', color: '#7c3aed', backgroundColor: 'white' }}
            title="Regenerate schedule from scratch"
          >
            ↺ Re-generate
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50 transition-all"
            style={{ backgroundColor: '#5a9228' }}
          >
            {saving ? 'Saving…' : saved ? '✅ Day Planned' : '📋 Plan Day'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl font-semibold text-sm border"
            style={{ borderColor: '#D0E8B8', color: '#5a9228' }}
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
