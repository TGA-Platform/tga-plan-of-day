/**
 * RatioTimeline
 * Shows a per-room day timeline:
 *  - Stacked children area (by age bracket)
 *  - Required staff step line
 *  - Actual rostered staff step line
 *  - Red reference areas where required > actual
 */
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceArea, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { calcRequiredStaff, AGE_BRACKETS, roomNameMatches } from '../utils/ratioEngine';
import type { Room, RosteredStaff } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChildRow {
  child_name: string;
  room: string;
  sign_in: string | null;
  sign_out: string | null;
  age: string | null;
  ageMonths: number;
}

// 7–09am and 4–6pm windows where support/float staff count toward ratio
const PEAK_WINDOWS = [
  { start: 7 * 60,  end: 9 * 60  },  // 07:00–09:00
  { start: 16 * 60, end: 18 * 60 },  // 16:00–18:00
];
function isPeakHour(m: number): boolean {
  return PEAK_WINDOWS.some(w => m >= w.start && m < w.end);
}

interface TimelineProps {
  // Single-room mode
  room?: Room;
  // All-rooms mode: pass all rooms + their staff combined
  rooms?: Room[];
  allRosteredStaff?: RosteredStaff[];  // all room staff across every room
  // Support + float staff who count toward ratio during peak windows (7–9am, 4–6pm)
  // Director should already be excluded by the caller
  peakHourStaff?: RosteredStaff[];
  // Common
  children: ChildRow[];
  rosteredStaff?: RosteredStaff[];
  date: string;
}

interface SlotData {
  label: string;       // "08:30"
  minutes: number;     // minutes since midnight
  u2:      number;     // children 0–2 yrs
  u3:      number;     // children 2–3 yrs
  u6:      number;     // children 3–6 yrs
  total:   number;
  required: number;
  actual:   number;
  peakExtra: number;   // extra staff counted in peak windows
  gap:      number;    // actual − required (negative = shortage)
  isPeak:   boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMinutes(timeStr: string | null | number): number | null {
  if (!timeStr) return null;
  const num = typeof timeStr === 'number' ? timeStr : parseInt(String(timeStr));

  // Unix timestamp (Deputy)
  if (!isNaN(num) && num > 100000) {
    const d = new Date(num * 1000);
    const sydney = new Date(d.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    return sydney.getHours() * 60 + sydney.getMinutes();
  }
  // HH:MM string (Owna attendance)
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
  return null;
}

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

const SLOT_INTERVAL = 15; // minutes
const DAY_START     = 6 * 60;   // 06:00
const DAY_END       = 19 * 60;  // 19:00

const COLORS = {
  u2:       '#60a5fa',  // blue  — 0-2 yrs
  u3:       '#34d399',  // green — 2-3 yrs
  u6:       '#a78bfa',  // purple — 3-6 yrs
  required: '#f97316',  // orange
  actual:   '#A0D083',  // TGA dark green
  gap:      '#fecaca',  // red fill for shortages
};

// Custom tooltip
interface TooltipEntry { name: string; value: number; color: string; payload?: SlotData; }
function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const slot = payload[0]?.payload as SlotData | undefined;
  if (!slot) return null;
  return (
    <div className="rounded-xl shadow-lg p-3 text-xs border" style={{ backgroundColor: 'white', borderColor: '#e0e8e0', minWidth: 160 }}>
      <div className="font-bold mb-1" style={{ color: '#2d5c18' }}>{label}</div>
      <div style={{ color: '#6b7280' }}>{slot.total} children present</div>
      {slot.u2 > 0 && <div style={{ color: COLORS.u2 }}>0–2 yrs: {slot.u2}</div>}
      {slot.u3 > 0 && <div style={{ color: '#059669' }}>2–3 yrs: {slot.u3}</div>}
      {slot.u6 > 0 && <div style={{ color: '#7c3aed' }}>3–6 yrs: {slot.u6}</div>}
      <div className="mt-1 pt-1 border-t" style={{ borderColor: '#E2F1DA' }}>
        <div style={{ color: COLORS.required }}>Required staff: {slot.required}</div>
        <div style={{ color: COLORS.actual }}>Rostered staff: {slot.actual}</div>
        {slot.isPeak && slot.peakExtra > 0 && (
          <div className="text-xs" style={{ color: '#7c3aed' }}>
            incl. {slot.peakExtra} support/float (peak hrs)
          </div>
        )}
        {slot.gap < 0 && (
          <div className="font-semibold mt-0.5" style={{ color: '#dc2626' }}>
            Short {Math.abs(slot.gap)} staff ⚠️
          </div>
        )}
        {slot.gap >= 0 && (
          <div style={{ color: '#16a34a' }}>{slot.gap > 0 ? `+${slot.gap} surplus` : 'Exactly covered ✅'}</div>
        )}
      </div>
    </div>
  );
}

export default function RatioTimeline({ room, rooms, children, rosteredStaff, allRosteredStaff, peakHourStaff, date }: TimelineProps) {
  const isAllRooms = !!rooms && rooms.length > 0;

  // Build per-slot data
  const slots: SlotData[] = [];

  // Pre-parse child times — all rooms or filtered to one
  const childTimes = children
    .filter(c => {
      if (isAllRooms) return true; // all rooms combined
      return roomNameMatches(c.room, room!);
    })
    .map(c => ({
      signIn:    toMinutes(c.sign_in),
      signOut:   toMinutes(c.sign_out),
      ageMonths: c.ageMonths,
      roomName:  c.room,
    }))
    .filter(c => c.signIn !== null);

  // Pre-parse staff shift times
  const staffSource = (isAllRooms ? allRosteredStaff : rosteredStaff) ?? [];
  const staffTimes = staffSource.map(s => ({
    start: toMinutes(s.startTime),
    end:   toMinutes(s.endTime),
  })).filter(s => s.start !== null && s.end !== null);

  // Peak-hour extra staff (support + floats, director excluded)
  const peakTimes = (peakHourStaff ?? []).map(s => ({
    start: toMinutes(s.startTime),
    end:   toMinutes(s.endTime),
  })).filter(s => s.start !== null && s.end !== null);

  // Current time in Sydney (for "now" line)
  const now = new Date();
  const sydneyNow = new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const isToday = date === `${sydneyNow.getFullYear()}-${String(sydneyNow.getMonth()+1).padStart(2,'0')}-${String(sydneyNow.getDate()).padStart(2,'0')}`;
  const nowMinutes = sydneyNow.getHours() * 60 + sydneyNow.getMinutes();

  for (let m = DAY_START; m <= DAY_END; m += SLOT_INTERVAL) {
    // Children present at this moment
    const presentKids = childTimes.filter(c => {
      if (c.signIn === null) return false;
      const signedIn  = c.signIn <= m;
      const signedOut = c.signOut !== null ? c.signOut <= m : false;
      return signedIn && !signedOut;
    });

    const u2 = presentKids.filter(c => c.ageMonths >= 0  && c.ageMonths < 24).length;
    const u3 = presentKids.filter(c => c.ageMonths >= 24 && c.ageMonths < 36).length;
    const u6 = presentKids.filter(c => c.ageMonths >= 36).length;

    // Required staff: sum cascade per room (ratio is per-room, not centre-wide)
    let required = 0;
    if (isAllRooms) {
      // Calculate per room and sum
      for (const r of rooms!) {
        const rChildren = presentKids.filter(c => roomNameMatches(c.roomName, r));
        const { required: rReq } = calcRequiredStaff(
          rChildren.map(c => ({ ageMonths: c.ageMonths } as any))
        );
        required += rReq;
      }
    } else {
      const { required: r } = calcRequiredStaff(
        presentKids.map(c => ({ ageMonths: c.ageMonths } as any))
      );
      required = r;
    }

    // Actual staff on duty at this moment
    // During peak windows (7–9am, 4–6pm) include support + float staff toward ratio
    const roomStaff = staffTimes.filter(s =>
      s.start !== null && s.end !== null && s.start <= m && s.end > m
    ).length;
    const peakExtra = isPeakHour(m)
      ? peakTimes.filter(s => s.start !== null && s.end !== null && s.start <= m && s.end > m).length
      : 0;
    const actual = roomStaff + peakExtra;

    slots.push({
      label:    minutesToLabel(m),
      minutes:  m,
      u2, u3, u6,
      total:    presentKids.length,
      required,
      actual,
      peakExtra,
      gap:      actual - required,
      isPeak:   isPeakHour(m),
    });
  }

  // Find gap zones for reference areas
  const gapZones: { start: string; end: string }[] = [];
  let gapStart: string | null = null;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].gap < 0 && gapStart === null) {
      gapStart = slots[i].label;
    } else if ((slots[i].gap >= 0 || i === slots.length - 1) && gapStart !== null) {
      gapZones.push({ start: gapStart, end: slots[i].label });
      gapStart = null;
    }
  }

  const maxY = Math.max(
    ...slots.map(s => Math.max(s.total, s.required, s.actual)),
    5
  ) + 1;

  const hasAnyData = slots.some(s => s.total > 0 || s.actual > 0);
  if (!hasAnyData) {
    return (
      <div className="flex items-center justify-center py-10 text-sm italic" style={{ color: '#9ca3af' }}>
        No attendance or roster data for this room today
      </div>
    );
  }

  return (
    <div>
      {/* Age legend */}
      <div className="flex flex-wrap gap-4 text-xs mb-3" style={{ color: '#6b7280' }}>
        {AGE_BRACKETS.map((b, i) => (
          <span key={b.label} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: [COLORS.u2, COLORS.u3, COLORS.u6][i] }} />
            {b.label} children (1:{b.ratio})
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-3 h-1 inline-block rounded" style={{ backgroundColor: COLORS.required }} />
          Required staff
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-1 inline-block rounded" style={{ backgroundColor: COLORS.actual }} />
          Rostered staff
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm inline-block opacity-40" style={{ backgroundColor: '#ef4444' }} />
          Ratio gap ⚠️
        </span>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={slots} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2F1DA" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            interval={3}   // every 45 min
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            domain={[0, maxY]}
            width={24}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Peak-hour shaded windows */}
          {PEAK_WINDOWS.map((w, i) => (
            <ReferenceArea
              key={`peak-${i}`}
              x1={minutesToLabel(w.start)} x2={minutesToLabel(w.end)}
              fill="#7c3aed" fillOpacity={0.06}
              strokeOpacity={0}
            />
          ))}

          {/* Gap zones (shortage) */}
          {gapZones.map((z, i) => (
            <ReferenceArea
              key={i}
              x1={z.start} x2={z.end}
              fill="#ef4444" fillOpacity={0.12}
              strokeOpacity={0}
            />
          ))}

          {/* Stacked children areas */}
          <Area type="stepAfter" dataKey="u2" stackId="children" stroke={COLORS.u2}  fill={COLORS.u2}  fillOpacity={0.35} strokeWidth={1} dot={false} isAnimationActive={false} name="0–2 yrs" />
          <Area type="stepAfter" dataKey="u3" stackId="children" stroke={COLORS.u3}  fill={COLORS.u3}  fillOpacity={0.35} strokeWidth={1} dot={false} isAnimationActive={false} name="2–3 yrs" />
          <Area type="stepAfter" dataKey="u6" stackId="children" stroke={COLORS.u6}  fill={COLORS.u6}  fillOpacity={0.35} strokeWidth={1} dot={false} isAnimationActive={false} name="3–6 yrs" />

          {/* Required staff */}
          <Line type="stepAfter" dataKey="required" stroke={COLORS.required} strokeWidth={2.5} dot={false} isAnimationActive={false} name="Required staff" />

          {/* Actual rostered staff */}
          <Line type="stepAfter" dataKey="actual" stroke={COLORS.actual} strokeWidth={2.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} name="Rostered staff" />

          {/* Now line */}
          {isToday && nowMinutes >= DAY_START && nowMinutes <= DAY_END && (
            <ReferenceLine
              x={minutesToLabel(Math.round(nowMinutes / SLOT_INTERVAL) * SLOT_INTERVAL)}
              stroke="#dc2626"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{ value: 'Now', position: 'top', fontSize: 9, fill: '#dc2626' }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
