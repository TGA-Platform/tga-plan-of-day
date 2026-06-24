import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
function safeFormat(d: Date | string | null | undefined, fmt: string): string {
  try {
    if (!d) return '--';
    const dt = d instanceof Date ? d : new Date(String(d));
    if (isNaN(dt.getTime())) return '--';
    return format(dt, fmt);
  } catch { return '--'; }
}
import { useSearchParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { CENTRES, WOLLONGONG_FLOAT_UNIT_IDS, WOLLONGONG_LEAVE_UNIT_IDS, WOLLONGONG_NONRATIO_UNIT_IDS } from '../config';
import { getUser } from '../auth';
import { fetchRosters } from '../deputy';
import { parseAgeMonths, buildRoomStatus } from '../utils/ratioEngine';
import { withCache, bustCache } from '../utils/cache';
import RatioTimeline from '../components/RatioTimeline';
import FloatSchedulePanel from '../components/FloatSchedulePanel';
import LunchBreakPanel from '../components/LunchBreakPanel';
import FloatBreakPanel from '../components/FloatBreakPanel';
import RatioCheckPanel, { type LunchAlert } from '../components/RatioCheckPanel';
import PredictedCoveragePanel from '../components/PredictedCoveragePanel';
import SummaryTab from '../components/SummaryTab';
import type { AttendanceChild, RoomRatioStatus, RosteredStaff, FloatStaff, ExternalCasualMeta } from '../types';
import type { FloatSchedule } from '../components/FloatSchedulePanel';

// --- Helpers -----------------------------------------------------------------

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// Deputy returns times as unix timestamps (seconds)
function formatTime(t: string | null | number): string {
  if (!t) return '';
  const num = typeof t === 'string' ? parseInt(t) : t;
  if (!isNaN(num) && num > 100000) {
    // Unix timestamp in seconds ? local time HH:MM
    const d = new Date(num * 1000);
    return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' });
  }
  return String(t);
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// --- Sub-components ----------------------------------------------------------

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

function StatusBadge({ status, shortage }: { status: 'green' | 'amber' | 'red'; shortage: number }) {
  if (status === 'red') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
        style={{ backgroundColor: '#fecaca', color: '#991b1b' }}>
        ⚠️ Short {shortage > 0 ? `${shortage}` : ''}
      </span>
    );
  }
  if (shortage < 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
        style={{ backgroundColor: '#bfdbfe', color: '#1d4ed8' }}>
        ➕ Surplus {Math.abs(shortage)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ backgroundColor: '#bbf7d0', color: '#166534' }}>
      ✅ Compliant
    </span>
  );
}

function AgeBreakdownRow({ label, count, ratio }: { label: string; count: number; ratio: number }) {
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span style={{ color: '#596570' }}>{label}</span>
      <span className="font-medium" style={{ color: '#2d5c18' }}>
        {count} {count === 1 ? 'child' : 'children'}
        <span className="font-normal opacity-60 ml-1">(1:{ratio})</span>
      </span>
    </div>
  );
}

function StaffChip({ staff }: { staff: RosteredStaff }) {
  const start = formatTime(staff.startTime);
  const end   = formatTime(staff.endTime);
  // Split shift: show each segment separately e.g. "7:00–10:00 / 14:00–18:00"
  const timeStr = staff.isSplitShift && staff.splitSegments?.length
    ? staff.splitSegments.map(seg => `${formatTime(seg.startTime)}–${formatTime(seg.endTime)}`).join(' / ')
    : start && end ? `${start}–${end}` : start || end || '';
  const meta = staff.externalCasualMeta;
  // Format cost e.g. 38250 → $382.50
  const costStr = meta?.costCents ? `$${(meta.costCents / 100).toFixed(2)}` : null;
  // Format cert e.g. CERT3 → Cert III, DIPLOMA → Diploma, ECT → ECT, NONE → ''
  const certLabel = meta?.certLevel && meta.certLevel !== 'NONE'
    ? meta.certLevel === 'CERT3' ? 'Cert III'
    : meta.certLevel === 'DIPLOMA' ? 'Diploma'
    : meta.certLevel
    : null;
  return (
    <div className="flex items-center gap-2 py-1">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
        style={{ backgroundColor: staff.isExternalCasual ? '#c2410c' : '#2d5c18' }}
        title={staff.employeeName}
      >
        {getInitials(staff.employeeName)}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium truncate flex items-center gap-1" style={{ color: '#2d5c18' }}>
          {staff.employeeName}
          {staff.isInternalCasual && (
            <span className="flex-shrink-0 text-xs font-semibold px-1 py-0 rounded" style={{ backgroundColor: '#fef3c7', color: '#92400e', fontSize: '9px', lineHeight: '14px' }}>IC</span>
          )}
          {staff.isExternalCasual && (
            <span className="flex-shrink-0 text-xs font-semibold px-1 py-0 rounded" style={{ backgroundColor: '#fed7aa', color: '#c2410c', fontSize: '9px', lineHeight: '14px' }}>EC</span>
          )}
          {certLabel && (
            <span className="flex-shrink-0 text-xs px-1 py-0 rounded" style={{ backgroundColor: '#e0e7ff', color: '#3730a3', fontSize: '9px', lineHeight: '14px' }}>{certLabel}</span>
          )}
          {staff.isSplitShift && (
            <span className="flex-shrink-0 text-xs font-semibold px-1 py-0 rounded" style={{ backgroundColor: '#e0e7ff', color: '#3730a3', fontSize: '9px', lineHeight: '14px' }}>SPLIT</span>
          )}
        </div>
        <div className="text-xs" style={{ color: '#596570' }}>
          {timeStr || 'Time not set'}
          {costStr && <span className="ml-1 font-medium" style={{ color: '#c2410c' }}>{costStr}</span>}
        </div>
      </div>
    </div>
  );
}

interface DragProps {
  onDragStart: (e: React.DragEvent, staff: RosteredStaff, sourceId: string) => void;
  onDragOver:  (e: React.DragEvent, targetId: string) => void;
  onDragLeave: () => void;
  onDrop:      (e: React.DragEvent, targetId: string) => void;
  isDragOver:  boolean;
  movedInFrom: Map<number, string>; // employeeId ? original room name
  movedOutIds: Set<number>;         // employees dragged away from this room
}

type RoomForecastData = { expected: number | null; weeksUsed: number; booked?: number | null } | null;

function RoomCard({ roomStatus, drag, forecast }: { roomStatus: RoomRatioStatus; drag?: DragProps; issAssigned?: FloatStaff[]; forecast?: RoomForecastData }) {
  const { room, presentCount, ageBreakdown, requiredStaff, staffCount, shortage, status, rosteredStaff } = roomStatus;

  const dragOver     = drag?.isDragOver ?? false;
  const borderColor  = dragOver ? '#5a9228' : status === 'red' ? '#fca5a5' : shortage < 0 ? '#bfdbfe' : '#D0E8B8';
  const headerBg     = status === 'red' ? '#fef2f2' : shortage < 0 ? '#eff6ff' : '#F5FAF3';

  return (
    <div
      className="rounded-2xl border overflow-hidden shadow-sm transition-all"
      style={{
        borderColor,
        borderWidth: dragOver ? 2 : 1,
        borderStyle: dragOver ? 'dashed' : 'solid',
        backgroundColor: dragOver ? '#f0f9f0' : 'white',
      }}
      onDragOver={drag ? e => drag.onDragOver(e, room.id) : undefined}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag ? e => drag.onDrop(e, room.id) : undefined}
    >
      {/* Room header */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: headerBg }}>
        <div>
          <div className="font-bold text-sm" style={{ color: '#2d5c18' }}>{room.name}</div>
          <div className="text-xs opacity-60" style={{ color: '#2d5c18' }}>{room.ageGroup}</div>
        </div>
        <div className="flex items-center gap-2">
          {dragOver && <span className="text-xs font-semibold" style={{ color: '#2d5c18' }}>Drop here</span>}
          <StatusBadge status={status} shortage={shortage} />
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Children count -- Expected / Booked / Actual */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#2d5c18' }}>Children</span>
          <span className="text-2xl font-bold" style={{ color: '#2d5c18' }}>{presentCount}</span>
        </div>
        {(forecast?.booked != null || forecast?.expected != null) && (
          <div className="flex gap-2 -mt-1 mb-1">
            {forecast?.expected != null && (
              <div className="flex-1 rounded-lg px-2 py-1 text-center" style={{ backgroundColor: '#f0f9ff' }}>
                <div className="text-xs font-bold" style={{ color: '#0369a1' }}>{forecast.expected}</div>
                <div className="text-xs" style={{ color: '#0284c7', opacity: 0.8 }}>expected</div>
              </div>
            )}
            {forecast?.booked != null && (
              <div className="flex-1 rounded-lg px-2 py-1 text-center" style={{ backgroundColor: '#f0f4ff' }}>
                <div className="text-xs font-bold" style={{ color: '#3730a3' }}>{forecast.booked}</div>
                <div className="text-xs" style={{ color: '#6366f1', opacity: 0.8 }}>booked</div>
              </div>
            )}
            {(forecast?.expected != null || forecast?.booked != null) && (() => {
              const base = forecast?.expected ?? forecast?.booked;
              if (base == null || presentCount === 0) return null;
              const diff = presentCount - base;
              if (diff === 0) return null;
              const over = diff > 0;
              return (
                <div className="flex-1 rounded-lg px-2 py-1 text-center" style={{ backgroundColor: over ? '#f0fdf4' : '#fefce8' }}>
                  <div className="text-xs font-bold" style={{ color: over ? '#15803d' : '#92400e' }}>{over ? '+' : ''}{diff}</div>
                  <div className="text-xs" style={{ color: over ? '#16a34a' : '#a16207', opacity: 0.8 }}>vs exp</div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Age breakdown */}
        {ageBreakdown.length > 0 && (
          <div className="border-t pt-2" style={{ borderColor: '#E2F1DA' }}>
            {ageBreakdown.map(b => (
              <AgeBreakdownRow key={b.bracket} label={b.bracket} count={b.count} ratio={b.ratio} />
            ))}
          </div>
        )}

        {/* Staff summary */}
        <div className="border-t pt-2" style={{ borderColor: '#E2F1DA' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#2d5c18' }}>Staff</span>
            <span className="text-sm font-bold" style={{ color: status === 'red' ? '#dc2626' : '#A0D083' }}>
              {staffCount} / {requiredStaff} needed
            </span>
          </div>

          {shortage > 0 && (
            <div className="text-xs font-medium px-2 py-1 rounded-lg mb-2" style={{ backgroundColor: '#fef3c7', color: '#78350f' }}>
              Need {shortage} float{shortage !== 1 ? 's' : ''}
            </div>
          )}

          {rosteredStaff.length > 0 ? (
            <div className="space-y-0">
              {rosteredStaff.map(s => {
                const fromRoom = drag?.movedInFrom.get(s.employeeId);
                return (
                  <div
                    key={`${s.employeeId}-${s.startTime}`}
                    draggable={!!drag}
                    onDragStart={drag ? e => drag.onDragStart(e, s, room.id) : undefined}
                    onClick={drag ? e => { e.stopPropagation(); drag.onDragStart(e as any, s, room.id); } : undefined}
                    className={drag ? 'cursor-grab active:cursor-grabbing' : ''}
                  >
                    <StaffChip staff={s} />
                    {fromRoom && (
                      <div className="ml-8 -mt-0.5 mb-0.5 text-xs font-medium" style={{ color: '#7c3aed' }}>
                        ← moved from {fromRoom}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs italic py-1" style={{ color: dragOver ? '#5a9228' : '#9ca3af' }}>
              {dragOver ? 'Drop staff here' : 'No staff rostered'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatFTE(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// -- Time helpers (shared with RatioTimeline approach) -------------------------
function toMins(t: string | number | null | undefined): number | null {
  if (!t) return null;
  const num = typeof t === 'number' ? t : parseInt(String(t));
  if (!isNaN(num) && num > 100000) {
    const syd = new Date(new Date(num * 1000).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    return syd.getHours() * 60 + syd.getMinutes();
  }
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  return null;
}
function minsToAmPm(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(min).padStart(2, '0')}${ampm}`;
}

// Window when children are present in a room (earliest sign-in ? latest sign-out)
function roomWindow(room: RoomRatioStatus, children: AttendanceChild[]): { start: number; end: number } | null {
  const owna = (room.room.ownaRoomName ?? room.room.name).toLowerCase();
  const rc = children.filter(c => c.sign_in && c.room.toLowerCase().includes(owna));
  if (!rc.length) return null;
  const starts = rc.map(c => toMins(c.sign_in)).filter((t): t is number => t !== null);
  const ends   = rc.map(c => toMins(c.sign_out) ?? 18 * 60);
  return { start: Math.min(...starts), end: Math.max(...ends) };
}

// How well does a floater's shift cover a room's active window?
function shiftCoverage(
  floatStart: number, floatEnd: number,
  winStart: number,   winEnd: number,
): { pct: number; overlapStart: number; overlapEnd: number; full: boolean } {
  const oStart = Math.max(floatStart, winStart);
  const oEnd   = Math.min(floatEnd,   winEnd);
  const overlap = Math.max(0, oEnd - oStart);
  const dur     = winEnd - winStart;
  const pct     = dur > 0 ? overlap / dur : 0;
  return { pct, overlapStart: oStart, overlapEnd: oEnd, full: pct >= 0.95 };
}

function FloatPoolSection({
  floats,
  onLeave,
  roomStatuses,
  totalChildren: _totalChildren,
  children,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragOver,
  onFloatClick,
  savedFloatIds,
  adStaff = [],
  externalCasuals = [],
}: {
  floats: FloatStaff[];
  onLeave: RosteredStaff[];
  roomStatuses: RoomRatioStatus[];
  totalChildren: number;
  children: AttendanceChild[];
  onDragStart?: (e: React.DragEvent, staff: RosteredStaff, sourceId: string) => void;
  onDragOver?:  (e: React.DragEvent, targetId: string) => void;
  onDragLeave?: () => void;
  onDrop?:      (e: React.DragEvent, targetId: string) => void;
  isDragOver?:  boolean;
  onFloatClick?: (f: FloatStaff) => void;
  savedFloatIds?: Set<number>;
  adStaff?: RosteredStaff[];
  externalCasuals?: RosteredStaff[];
}) {
  // -- Step 1: Identify short and surplus rooms ---------------------------
  const shortageRooms = [...roomStatuses]
    .filter(r => r.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage);
  const surplusRooms = [...roomStatuses]
    .filter(r => r.shortage < 0)
    .sort((a, b) => a.shortage - b.shortage); // most surplus first

  const totalRatioShortage = shortageRooms.reduce((sum, r) => sum + r.shortage, 0);
  const totalSurplus       = surplusRooms.reduce((sum, r) => sum + Math.abs(r.shortage), 0);

  // -- Step 2: Reallocate surplus staff to cover shortages first -----------
  const surplusCoveringShortage = Math.min(totalSurplus, totalRatioShortage);
  const netShortageAfterRealloc = Math.max(0, totalRatioShortage - totalSurplus);

  // Which rooms still need a floater after surplus reallocation
  let remainingRealloc = totalSurplus;
  const roomsStillShort = shortageRooms
    .map(r => {
      const covered = Math.min(r.shortage, remainingRealloc);
      remainingRealloc -= covered;
      return { ...r, remainingShortage: r.shortage - covered };
    })
    .filter(r => r.remainingShortage > 0);

  // Surplus reallocation suggestions: which short rooms each surplus room should send to
  type Reallocation = { from: string; to: string; count: number };
  const reallocations: Reallocation[] = [];
  {
    let surplusPool = surplusRooms.map(r => ({ name: r.room.name, available: Math.abs(r.shortage) }));
    for (const short of shortageRooms) {
      let toFill = short.shortage;
      for (const src of surplusPool) {
        if (toFill <= 0 || src.available <= 0) continue;
        const n = Math.min(toFill, src.available);
        reallocations.push({ from: src.name, to: short.room.name, count: n });
        src.available -= n;
        toFill -= n;
      }
    }
  }

  // -- Step 3: Assign floaters to remaining shortages ------------------------
  // Sort by shift overlap with the room's active child window — best coverage first
  type RatioAssignment = {
    float: FloatStaff;
    room: string;
    win: { start: number; end: number } | null;
    cov: { pct: number; overlapStart: number; overlapEnd: number; full: boolean } | null;
  };
  const ratioAssignments: RatioAssignment[] = [];
  const assignedIds = new Set<string>();

  for (const rs of roomsStillShort) {
    const win = roomWindow(rs, children);

    // Rank available floats by overlap with this room's window
    const ranked = floats
      .filter(f => !assignedIds.has(`${f.employeeId}-${f.startTime}`))
      .map(f => {
        const fs = toMins(f.startTime);
        const fe = toMins(f.endTime);
        const cov = (fs !== null && fe !== null && win)
          ? shiftCoverage(fs, fe, win.start, win.end)
          : null;
        return { f, fs, fe, cov, score: cov?.pct ?? 0 };
      })
      .sort((a, b) => b.score - a.score);

    for (let i = 0; i < rs.remainingShortage && ranked.length > 0; i++) {
      const best = ranked.shift()!;
      assignedIds.add(`${best.f.employeeId}-${best.f.startTime}`);
      ratioAssignments.push({ float: best.f, room: rs.room.name, win, cov: best.cov });
    }
  }

  const bufferFloats = floats.filter(f => !assignedIds.has(`${f.employeeId}-${f.startTime}`));

  // -- Floor staff & buffer -------------------------------------------------
  const totalFloorStaff = roomStatuses.reduce((sum, r) => sum + r.staffCount, 0);
  const bufferRequired  = totalFloorStaff > 0 ? totalFloorStaff / 6 : 0;

  // AD staff available as floaters — ONLY for under-100 place centres
  // Centres with 100+ children: AD is excluded from float pool count
  const centreChildCount = _totalChildren ?? children.length;
  const adAvailable = (centreChildCount > 0 && centreChildCount < 100) ? (adStaff ?? []).length : 0;

  // Room net surplus (after covering shortages) counts as effective floats
  const roomNetSurplus      = Math.max(0, totalSurplus - totalRatioShortage);
  const effectiveFloatCount = floats.length + roomNetSurplus;
  // Totals (surplus realloc first, then floaters, then casuals)
  const totalFloatersNeeded = Math.max(0, netShortageAfterRealloc + bufferRequired);
  const casualsNeeded = Math.max(0, totalFloatersNeeded - effectiveFloatCount - adAvailable);
  const casualsFull   = Math.floor(casualsNeeded);
  const casualsHalf   = casualsNeeded - casualsFull >= 0.5 ? 1 : 0;

  const coverageOk = casualsNeeded <= 0;

  return (
    <div
      className="rounded-2xl border shadow-sm overflow-hidden"
      style={{
        borderColor: isDragOver ? '#5a9228' : '#e0e8e0',
        borderWidth: isDragOver ? 2 : 1,
        borderStyle: isDragOver ? 'dashed' : 'solid',
        backgroundColor: isDragOver ? '#f0f9f0' : 'white',
      }}
      onDragOver={onDragOver ? e => onDragOver(e, 'float') : undefined}
      onDragLeave={onDragLeave}
      onDrop={onDrop ? e => onDrop(e, 'float') : undefined}
    >
      {/* Header */}
      <div className="px-4 py-3" style={{ backgroundColor: '#F5FAF3' }}>
        <div className="flex items-center justify-between">
          <div className="font-bold text-sm" style={{ color: '#2d5c18' }}>Float Pool</div>
          {isDragOver && <span className="text-xs font-semibold" style={{ color: '#2d5c18' }}>Drop to return to pool</span>}
        </div>
        <div className="text-xs opacity-60" style={{ color: '#2d5c18' }}>
          {floats.length} float{floats.length !== 1 ? 's' : ''} available
          {onLeave.length > 0 && ` · ${onLeave.length} on leave`}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">

        {/* -- Staffing needs summary -- */}
        <div
          className="rounded-xl p-3 space-y-1.5"
          style={{ backgroundColor: coverageOk ? '#F5FAF3' : '#fef2f2' }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#2d5c18' }}>Staffing Analysis</div>

          <div className="flex justify-between text-xs">
            <span style={{ color: '#596570' }}>Floor staff (ratio rooms)</span>
            <span className="font-medium" style={{ color: '#2d5c18' }}>{totalFloorStaff}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: '#596570' }}>Ratio shortages</span>
            <span className="font-medium" style={{ color: totalRatioShortage > 0 ? '#dc2626' : '#A0D083' }}>
              {totalRatioShortage > 0 ? `${totalRatioShortage} staff (${shortageRooms.length} room${shortageRooms.length !== 1 ? 's' : ''} short)` : 'None'}
            </span>
          </div>
          {totalSurplus > 0 && (
            <div className="flex justify-between text-xs">
              <span style={{ color: '#596570' }}>Surplus from other rooms</span>
              <span className="font-medium" style={{ color: '#16a34a' }}>
                -{surplusCoveringShortage} staff ({surplusRooms.length} room{surplusRooms.length !== 1 ? 's' : ''} over)
              </span>
            </div>
          )}
          {totalSurplus > 0 && (
            <div className="flex justify-between text-xs">
              <span style={{ color: '#596570' }}>Net ratio shortfall</span>
              <span className="font-medium" style={{ color: netShortageAfterRealloc > 0 ? '#dc2626' : '#16a34a' }}>
                {netShortageAfterRealloc > 0 ? `${netShortageAfterRealloc} floater${netShortageAfterRealloc !== 1 ? 's' : ''} needed` : 'Covered by reallocation ✅'}
              </span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span style={{ color: '#596570' }}>Floor buffer (1 per 6 staff)</span>
            <span className="font-medium" style={{ color: '#2d5c18' }}>{formatFTE(bufferRequired)} FTE</span>
          </div>

          <div className="border-t pt-1.5 mt-1" style={{ borderColor: coverageOk ? '#D0E8B8' : '#fca5a5' }}>
            <div className="flex justify-between text-xs">
              <span className="font-semibold" style={{ color: '#2d5c18' }}>Total floaters needed</span>
              <span className="font-bold" style={{ color: '#2d5c18' }}>{formatFTE(totalFloatersNeeded)} FTE</span>
            </div>
            <div className="flex justify-between text-xs mt-0.5">
              <span style={{ color: '#596570' }}>Available (floats{adAvailable > 0 ? ` + ${adAvailable} AD` : ''})</span>
              <span className="font-medium" style={{ color: '#2d5c18' }}>{effectiveFloatCount + adAvailable}{roomNetSurplus > 0 && <span style={{ color: '#7c3aed', fontSize: '11px' }}> (+{roomNetSurplus} rm)</span>}</span>
            </div>
          </div>

          {/* Float surplus / casual recommendation */}
          {coverageOk ? (
            <div className="pt-0.5 space-y-0.5">
              <div className="flex justify-between text-xs">
                <span style={{ color: '#16a34a', fontWeight: 600 }}>✅ No casuals needed</span>
                {effectiveFloatCount + adAvailable > totalFloatersNeeded && (
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>
                    +{formatFTE(effectiveFloatCount + adAvailable - totalFloatersNeeded)} FTE over
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div
              className="rounded-lg px-2 py-1.5 mt-1"
              style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}
            >
              <div className="text-xs font-bold">⚠️ Recommend {formatFTE(casualsNeeded)} casual FTE today</div>
              {(casualsFull > 0 || casualsHalf > 0) && (
                <div className="text-xs mt-0.5" style={{ color: '#b91c1c' }}>
                  {[casualsFull > 0 && `${casualsFull} full shift${casualsFull !== 1 ? 's' : ''}`, casualsHalf > 0 && '1 half shift']
                    .filter(Boolean).join(' + ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* -- Surplus reallocation suggestions -- */}
        {reallocations.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#16a34a' }}>Surplus Reallocation</div>
            <div className="space-y-1">
              {reallocations.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-0.5">
                  <span style={{ color: '#2d5c18' }}>{r.from}</span>
                  <span className="flex items-center gap-1" style={{ color: '#596570' }}>
                    <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>+{r.count}</span>
                    →
                    <span style={{ color: '#2d5c18' }}>{r.to}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* -- Active floats -- */}
        {floats.length > 0 ? (
          <div>
            {/* Ratio assignments */}
            {ratioAssignments.length > 0 && (
              <div className="mb-2">
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#92400e' }}>Ratio Coverage</div>
                <div className="space-y-1.5">
                  {ratioAssignments.map(({ float: f, room, win, cov }) => { // eslint-disable-line
                    const partial = cov && !cov.full && cov.pct > 0;
                    const noOverlap = cov && cov.pct === 0;
                    return (
                      <div
                        key={`${f.employeeId}-${f.startTime}`}
                        draggable={!!onDragStart}
                        onDragStart={onDragStart ? e => onDragStart(e, f, 'float') : undefined}
                        className={onDragStart ? 'cursor-grab active:cursor-grabbing' : ''}
                      >
                        <div className="flex items-center justify-between">
                          <StaffChip staff={f} />
                          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={noOverlap
                                ? { backgroundColor: '#fee2e2', color: '#991b1b' }
                                : { backgroundColor: '#fef3c7', color: '#78350f' }
                              }
                            >
                              → {room}
                            </span>
                            <button
                              onClick={() => onFloatClick?.(f)}
                              className="text-xs px-2 py-0.5 rounded-full font-medium hover:opacity-80"
                              style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}
                            >
                              📋
                            </button>
                          </div>
                        </div>
                        {/* Coverage indicator */}
                        {win && cov !== null && (
                          <div className="ml-8 mt-0.5 text-xs" style={{ color: noOverlap ? '#dc2626' : partial ? '#d97706' : '#16a34a' }}>
                            {noOverlap
                              ? `⚠️ No overlap — room active ${minsToAmPm(win.start)}–${minsToAmPm(win.end)}`
                              : cov.full
                              ? `✅ Full coverage`
                              : `🟡 Partial — covers ${minsToAmPm(cov.overlapStart)}–${minsToAmPm(cov.overlapEnd)} (${Math.round(cov.pct * 100)}%)`
                            }
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Buffer floats */}
            {bufferFloats.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#2d5c18' }}>Buffer Pool</div>
                <div className="space-y-0">
                  {bufferFloats.map(f => (
                    <div
                      key={`${f.employeeId}-${f.startTime}`}
                      draggable={!!onDragStart}
                      onDragStart={onDragStart ? e => onDragStart(e, f, 'float') : undefined}
                      className={`flex items-center justify-between ${onDragStart ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                      <StaffChip staff={f} />
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        <button
                          onClick={() => onFloatClick?.(f)}
                          className="text-xs px-2 py-0.5 rounded-full font-medium hover:opacity-80"
                          style={{ backgroundColor: savedFloatIds?.has(f.employeeId) ? '#bbf7d0' : '#E2F1DA', color: '#2d5c18' }}
                        >
                          {savedFloatIds?.has(f.employeeId) ? '✅ Day Planned' : '📋 Plan day'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm italic py-1" style={{ color: '#596570' }}>No floats rostered today</div>
        )}

        {/* Z Staffing External Casuals (EC) */}
        {externalCasuals.length > 0 && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: '#fed7aa' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#c2410c' }}>External Casuals</div>
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: '#fed7aa', color: '#c2410c' }}>EC</span>
              <span className="text-xs" style={{ color: '#78350f' }}>via Z Staffing</span>
            </div>
            <div className="space-y-0">
              {externalCasuals.map(ec => (
                <div
                  key={ec.externalCasualMeta?.zJobId ?? ec.employeeId}
                  className="flex items-center justify-between"
                >
                  <StaffChip staff={ec} />
                </div>
              ))}
            </div>
            {/* Total cost summary */}
            {(() => {
              const totalCents = externalCasuals.reduce((s, ec) => s + (ec.externalCasualMeta?.costCents ?? 0), 0);
              return totalCents > 0 ? (
                <div className="mt-2 text-xs font-semibold text-right" style={{ color: '#c2410c' }}>
                  EC total: ${(totalCents / 100).toFixed(2)}
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* AD staff — shown when centre has <100 approved places */}
        {adStaff.length > 0 && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: '#fde68a' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#92400e' }}>Assistant Director</div>
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>AD</span>
            </div>
            <div className="space-y-0">
              {adStaff.map(s => (
                <div
                  key={`${s.employeeId}-${s.startTime}-ad`}
                  draggable={!!onDragStart}
                  onDragStart={onDragStart ? e => onDragStart(e, s as FloatStaff, 'float') : undefined}
                  className={`flex items-center justify-between ${onDragStart ? 'cursor-grab active:cursor-grabbing' : ''}`}
                >
                  <StaffChip staff={s} />
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>AD</span>
                    {onFloatClick && (
                      <button
                        onClick={() => onFloatClick(s as FloatStaff)}
                        className="text-xs px-2 py-0.5 rounded-full font-medium hover:opacity-80"
                        style={{ backgroundColor: savedFloatIds?.has(s.employeeId) ? '#bbf7d0' : '#E2F1DA', color: '#2d5c18' }}
                      >
                        {savedFloatIds?.has(s.employeeId) ? '✅ Day Planned' : '📋 Plan day'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* On leave */}
        {onLeave.length > 0 && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: '#E2F1DA' }}>
            <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#596570' }}>On Leave</div>
            <div className="space-y-1">
              {onLeave.map(s => (
                <div key={`${s.employeeId}-${s.startTime}`} className="flex items-center gap-2 py-1 opacity-50">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: '#596570' }}
                  >
                    {getInitials(s.employeeName)}
                  </div>
                  <span className="text-xs line-through" style={{ color: '#6b7280' }}>{s.employeeName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main component ----------------------------------------------------------

export default function RatioDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const user = getUser();

  // Centre selection — persisted in URL (?centre=wollongong)
  // CEO can pick any; directors default to their own centre
  const availableCentres = user?.role === 'ceo' ? CENTRES : CENTRES.filter(c => c.id === user?.centreId);
  // Support ?campus= param from summary page (match by ownaName or name)
  const campusParam = searchParams.get('campus');
  const centreFromCampus = campusParam
    ? CENTRES.find(c => (c.ownaName ?? c.name).toLowerCase() === campusParam.toLowerCase() || c.name.toLowerCase() === campusParam.toLowerCase())
    : null;
  const viewMode = searchParams.get('mode') === 'expected' ? 'expected' : 'live';
  const defaultCentreId = centreFromCampus?.id || searchParams.get('centre') || availableCentres[0]?.id || 'wollongong';
  const [selectedCentreId, setSelectedCentreId] = useState(defaultCentreId);

  const centre        = CENTRES.find(c => c.id === selectedCentreId) ?? CENTRES[0];
  const roomUnitIds   = centre.rooms.map(r => r.deputyUnitId);
  const floatUnitIds  = centre.floatUnitIds  ?? WOLLONGONG_FLOAT_UNIT_IDS;
  const issUnitIds    = centre.issUnitIds    ?? [];
  const leaveUnitIds  = centre.leaveUnitIds  ?? WOLLONGONG_LEAVE_UNIT_IDS;
  const nonRatioUnitIds = centre.nonRatioUnitIds ?? WOLLONGONG_NONRATIO_UNIT_IDS;
  const allUnitIds    = [...roomUnitIds, ...floatUnitIds, ...issUnitIds, ...leaveUnitIds, ...nonRatioUnitIds];

  function handleCentreChange(id: string) {
    setSelectedCentreId(id);
    setSearchParams({ centre: id });
  }

  const [date, setDate]               = useState(todayStr());

  const [children, setChildren]       = useState<AttendanceChild[]>([]);
  const [roomStatuses, setRoomStatuses] = useState<RoomRatioStatus[]>([]);
  const [floats, setFloats]           = useState<FloatStaff[]>([]);
  const [onLeave, setOnLeave]         = useState<RosteredStaff[]>([]);
  const [supportStaff, setSupportStaff] = useState<RosteredStaff[]>([]);
  const [issStaff, setIssStaff]           = useState<FloatStaff[]>([]);
  const [allRosters, setAllRosters]   = useState<RosteredStaff[]>([]);
  // Set of normalised names who are internal casuals (from staff_wwcc table)
  const [internalCasualSet, setInternalCasualSet] = useState<Set<string>>(new Set());
  // External casuals from Z Staffing (converted to RosteredStaff)
  const [externalCasuals, setExternalCasuals] = useState<RosteredStaff[]>([]);
  const [activeView, setActiveView]   = useState<'plan-of-day' | 'ratio-check' | 'summary'>('plan-of-day');
  const [planSubView, setPlanSubView] = useState<'live' | 'plan'>('live');

  // Expected mode: use same weekday 7 days ago as attendance source for planning
  // showCurrentOnly: Live mode shows currently signed-in children; Plan uses historical all-day data.
  // For future dates the attendance data comes from last week (effectiveDate = date - 7 days),
  // and every child from that past day will have a sign_out — so showCurrentOnly would
  // filter all of them out. Always use all-day mode for future dates.
  const isFutureDate = date > todayStr();
  const [lunchAlerts, setLunchAlerts] = useState<LunchAlert[]>([]);
  const showCurrentOnly = !isFutureDate && planSubView === 'live';

  // effectiveDate: which date's attendance data to fetch.
  // - For today or past dates: actual Owna data exists — use it directly.
  // - For future dates: no actual data yet — fall back to same weekday last week.
  // - Explicit 'expected' mode always uses prior-week for forward-looking planning.
  const effectiveDate = React.useMemo(() => {
    if (viewMode === 'expected') {
      const d = new Date(date + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - 7);
      return d.toISOString().slice(0, 10);
    }
    // For today or any past date, actual attendance records exist in Owna/Supabase
    if (date <= todayStr()) return date;
    // Future date: fall back to same weekday last week
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  }, [date, viewMode]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [ownaRefreshedAt, setOwnaRefreshedAt] = useState<Date | null>(null);

  // Booked / Expected forecast data per room
  type RoomForecast = { expected: number | null; weeksUsed: number; booked?: number | null };
  type ForecastData = { booked: number | null; capacity: number | null; rooms: Record<string, RoomForecast> };
  const [forecast, setForecast] = useState<ForecastData | null>(null);

  // -- Drag-and-drop: manual staff reallocation (persisted per centre+date) --------
  const movesKey = `tga_pod_moves:${selectedCentreId}:${date}`;
  const [scheduledFloat, setScheduledFloat] = useState<FloatStaff | null>(null);
  const [savedFloatIds, setSavedFloatIds]   = useState<Set<number>>(new Set());
  const [lunchReloadKey, setLunchReloadKey] = useState(0);

  const [staffMoves, setStaffMoves]   = useState<Record<number, string>>({});
  const [dropTarget, setDropTarget]   = useState<string | null>(null);
  const [movesSaved, setMovesSaved]   = useState(false);
  const [saveFlash, setSaveFlash]     = useState(false);

  // Load saved moves: Supabase first, fall back to localStorage
  useEffect(() => {
    let cancelled = false;
    async function loadMoves() {
      // 1. Check localStorage immediately (fast)
      const localRaw = localStorage.getItem(movesKey);
      const localMoves = localRaw ? (() => { try { return JSON.parse(localRaw); } catch { return null; } })() : null;
      if (localMoves) { setStaffMoves(localMoves); setMovesSaved(true); }

      // 2. Then fetch from Supabase (authoritative)
      try {
        const r = await fetch(`/api/staff-allocations?centre=${encodeURIComponent(selectedCentreId)}&date=${date}`);
        if (!r.ok || cancelled) return;
        const rows: { moves: Record<number, string> }[] = await r.json();
        if (rows.length > 0 && !cancelled) {
          const moves = rows[0].moves;
          setStaffMoves(moves);
          setMovesSaved(true);
          // Keep local in sync
          localStorage.setItem(movesKey, JSON.stringify(moves));
        } else if (!localMoves && !cancelled) {
          setStaffMoves({});
          setMovesSaved(false);
        }
      } catch { /* offline — local copy is fine */ }
    }
    loadMoves();
    return () => { cancelled = true; };
  }, [movesKey, selectedCentreId, date]);

  async function saveMoves() {
    const moves = staffMoves;
    // 1. Save to localStorage immediately
    localStorage.setItem(movesKey, JSON.stringify(moves));
    setMovesSaved(true);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 2000);
    // 2. Persist to Supabase
    try {
      await fetch('/api/staff-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centre_id: selectedCentreId,
          date,
          moves,
          saved_by: user?.email ?? null,
        }),
      });
    } catch { /* offline — saved locally, will need to re-save when online */ }
  }

  const hasOverrides = Object.keys(staffMoves).length > 0;

  function onDragStart(e: React.DragEvent, staff: RosteredStaff, sourceId: string) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('employeeId', String(staff.employeeId));
    e.dataTransfer.setData('sourceId', sourceId);
  }
  function onDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(targetId);
  }
  function onDragLeave() { setDropTarget(null); }
  function onDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDropTarget(null);
    const empId   = parseInt(e.dataTransfer.getData('employeeId'));
    const source  = e.dataTransfer.getData('sourceId');
    if (!empId || source === targetId) return;
    setStaffMoves(prev => ({ ...prev, [empId]: targetId }));
    setMovesSaved(false); // unsaved changes
  }
  function resetMoves() {
    setStaffMoves({});
    localStorage.removeItem(movesKey);
    setMovesSaved(false);
  }

  // Effective room statuses — always rebuilt with current view mode so switching
  // between "All Day" and "Currently Present" is instantly reflected without refetch.
  // roomStatuses is always stored with showCurrentOnly=false (full day data).
  // Stamp isInternalCasual onto every roster entry based on the fetched casual set
  const normName = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim();
  const tagCasual = useCallback(<T extends RosteredStaff>(arr: T[]): T[] =>
    internalCasualSet.size === 0 ? arr : arr.map(s => ({ ...s, isInternalCasual: internalCasualSet.has(normName(s.employeeName)) }))
  , [internalCasualSet]);

  const effectiveRoomStatuses = useMemo((): RoomRatioStatus[] => {
    const nowS = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    const nowM  = nowS.getHours() * 60 + nowS.getMinutes();

    if (!hasOverrides) {
      // No manual moves — re-apply current mode filter to full-day data
      return roomStatuses.map(rs =>
        buildRoomStatus(rs.room, children as any, tagCasual(rs.rosteredStaff), showCurrentOnly, nowM)
      );
    }

    // Manual moves — rebuild with overrides + current mode filter
    const staffOrigin = new Map<number, { staff: RosteredStaff; roomId: string }>();
    roomStatuses.forEach(rs => rs.rosteredStaff.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: rs.room.id })));
    floats.forEach(f => staffOrigin.set(f.employeeId, { staff: f, roomId: 'float' }));
    supportStaff.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: 'support' }));
    issStaff.forEach(s => staffOrigin.set(s.employeeId, { staff: s, roomId: 'iss' }));

    return roomStatuses.map(rs => {
      const staying = rs.rosteredStaff.filter(s => {
        const dest = staffMoves[s.employeeId];
        return dest === undefined || dest === rs.room.id;
      });
      const movedIn = [...staffOrigin.values()]
        .filter(({ staff: s, roomId }) => staffMoves[s.employeeId] === rs.room.id && roomId !== rs.room.id)
        .map(({ staff }) => staff);
      const issMovedHere = issStaff.filter(s =>
        staffMoves[s.employeeId] === rs.room.id &&
        !staying.some(x => x.employeeId === s.employeeId) &&
        !movedIn.some(x => x.employeeId === s.employeeId)
      );
      return buildRoomStatus(rs.room, children as any, tagCasual([...staying, ...movedIn, ...issMovedHere]), showCurrentOnly, nowM);
    });
  }, [roomStatuses, floats, issStaff, supportStaff, staffMoves, children, showCurrentOnly, hasOverrides, tagCasual]);

  // ISS staff: split into unassigned, moved-to-room, moved-to-float
  const effectiveIssStaff = useMemo((): FloatStaff[] => {
    return issStaff.filter(s => !staffMoves[s.employeeId] || staffMoves[s.employeeId] === 'iss');
  }, [issStaff, staffMoves]);

  const issDeployed = useMemo((): { staff: FloatStaff; dest: string; destLabel: string }[] => {
    return issStaff
      .filter(s => { const d = staffMoves[s.employeeId]; return d && d !== 'iss'; })
      .map(s => {
        const dest = staffMoves[s.employeeId]!;
        const room = centre.rooms.find(r => r.id === dest || r.name === dest);
        const destLabel = dest === 'float' ? 'Float pool' : (room?.name ?? dest);
        return { staff: s, dest, destLabel };
      });
  }, [issStaff, staffMoves, centre.rooms]);

  // AD staff: always shown in float pool (with AD badge) when rostered — they can step
  // into ratio when needed regardless of centre size. Detected by Deputy unit name.
  const adStaff = useMemo((): RosteredStaff[] => {
    return supportStaff.filter(s =>
      s.unitName?.toLowerCase().includes('assistant director') ||
      s.unitName?.toLowerCase().includes('asst director') ||
      s.unitName?.toLowerCase().includes('ass. director')
    );
  }, [supportStaff]);

  // ISS are tracked in their own panel — excluded from float pool display
  // AD staff (when <100 places) are included in the float pool count automatically
  const effectiveFloats = useMemo((): FloatStaff[] => {
    // ADs shown separately with AD badge; excluded from main float list to avoid double-display
    const adIds = new Set(adStaff.map(s => s.employeeId));
    // Support staff manually moved to float pool
    const supportAsFloats = supportStaff
      .filter(s => staffMoves[s.employeeId] === 'float' && !adIds.has(s.employeeId)) as FloatStaff[];
    // Room staff manually moved to float pool (they disappear from their room card)
    const roomStaffAsFloats = roomStatuses
      .flatMap(rs => rs.rosteredStaff)
      .filter(s => staffMoves[s.employeeId] === 'float') as FloatStaff[];
    const result = !hasOverrides
      ? [...floats, ...supportAsFloats]
      : [
          ...floats.filter(f => !staffMoves[f.employeeId] || staffMoves[f.employeeId] === 'float'),
          ...supportAsFloats,
          ...roomStaffAsFloats,
        ];
    // Split shift rule: only count staff in the float pool if their shift overlaps
    // the 10am–2pm core window. Staff who only work morning (e.g. 7am–11am) or
    // afternoon (e.g. 2pm–6pm) should not inflate the float pool count —
    // they go under Support instead. Manually moved staff always stay in float pool
    // regardless of their shift time (explicit override).
    const WINDOW_START = 10 * 60; // 10:00

    const filtered = tagCasual(result).filter((f: FloatStaff) => {
      // Always keep manually moved staff (explicit director decision)
      if (staffMoves[f.employeeId]) return true;
      // Split-shift staff are excluded from auto float pool (go to Support instead).
      // Director can still manually drag them to float via staffMoves above.
      if (f.isSplitShift) return false;
      const s = toMins(f.startTime);
      const e = toMins(f.endTime);
      if (s === null || e === null) return true; // no time info, keep
      // Overlaps 10am–2pm usefully = ends after 10am AND starts early enough
      // to cover at least one 30-min break before 2pm (i.e. starts before 13:30).
      // A shift starting at 13:45 only has 15 min before window closes — not useful.
      const USEFUL_START_CUTOFF = 13 * 60 + 30; // 13:30
      return e > WINDOW_START && s < USEFUL_START_CUTOFF;
    });
    return filtered as FloatStaff[];
  }, [floats, supportStaff, adStaff, roomStatuses, staffMoves, hasOverrides, tagCasual]);

  // Effective support staff: those not dragged into a room
  const effectiveSupportStaff = useMemo((): RosteredStaff[] => {
    const arr = !hasOverrides ? supportStaff : supportStaff.filter(s => !staffMoves[s.employeeId] || staffMoves[s.employeeId] === 'support');
    return tagCasual(arr);
  }, [supportStaff, staffMoves, hasOverrides, tagCasual]);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setForecast(null);
    try {
      // Fetch attendance + rosters in parallel (cached for 5 min)
      // Use ownaName for Supabase campus lookup (e.g. 'Ed Park 2' not 'Edmondson Park 2')
      const campusName = centre.ownaName ?? centre.name;
      const attKey = `attendance:${campusName}:${effectiveDate}`;
      const rosterKey = `rosters:${selectedCentreId}:${date}`;
      const forecastKey = `forecast:${campusName}:${date}`;

      // When force-refreshing, bust browser-side cache for this centre+date
      if (forceRefresh) {
        bustCache(attKey);
        bustCache(rosterKey);
        bustCache(forecastKey);
      }

      // For future dates beyond today: use enrolled children + project ages at the target date
      // rather than fetching last week's attendance (which gives wrong ages and wrong room data).
      const useFutureEnrolled = isFutureDate;

      const [attendanceRes, enrolledRes, rosters, forecastRes] = await Promise.all([
        useFutureEnrolled
          ? Promise.resolve([])
          : withCache(attKey, () => fetch(`/api/attendance?campus=${encodeURIComponent(campusName)}&date=${effectiveDate}`).then(r => r.json())),
        useFutureEnrolled
          ? withCache(`expected:${campusName}:${date}`, () => fetch(`/api/children-expected?campus=${encodeURIComponent(campusName)}&date=${date}`).then(r => r.json()), 900000)
          : Promise.resolve([]),
        withCache(rosterKey, () => fetchRosters(date, allUnitIds, forceRefresh)),
        withCache(forecastKey, () => fetch(`/api/room-forecast?campus=${encodeURIComponent(campusName)}&date=${date}`).then(r => r.json()).catch(() => null), 300000),
      ]);
      setForecast(forecastRes ?? null);

      let childRows: AttendanceChild[];

      if (useFutureEnrolled && Array.isArray(enrolledRes) && enrolledRes.length > 0) {
        // children-expected API returns children expected on this specific weekday
        // based on historical attendance patterns, with age already projected to target date
        childRows = (enrolledRes as { full_name: string; room: string | null; dob: string | null; ageMonths: number | null }[]).map(c => ({
          child_name:           c.full_name,
          room:                 c.room ?? '',
          sign_in:              '08:00',  // assumed present all day for ratio planning
          sign_out:             null,
          predicted_sign_out:   null,
          age:                  null,
          ageMonths:            c.ageMonths ?? 36,
        }));
        setOwnaRefreshedAt(null); // no Owna scrape for future dates
      } else {
        // Past/today: map actual attendance rows
        const safeAttendance: { child_name: string; room: string; sign_in: string|null; sign_out: string|null; predicted_sign_out: string|null; age: string|null; updated_at?: string|null }[] = Array.isArray(attendanceRes) ? attendanceRes : [];
        childRows = safeAttendance.map(row => ({
          child_name: row.child_name,
          room: row.room,
          sign_in: row.sign_in,
          sign_out: row.sign_out,
          predicted_sign_out: row.predicted_sign_out ?? null,
          age: row.age,
          ageMonths: parseAgeMonths(row.age),
        }));
        const latestScrape = safeAttendance
          .map(r => r.updated_at ? new Date(r.updated_at) : null)
          .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
        setOwnaRefreshedAt(latestScrape);
      }

      setChildren(childRows);

      // Separate rosters by type
      // Timesheet fallback: inject staff who clocked in but have no roster entry.
      // This catches Deputy API gaps (e.g. roster exists in Deputy UI but QUERY API omits it).
      try {
        const tsRes = await fetch(`/api/deputy-timesheets-actual?unitIds=${allUnitIds.join(',')}&date=${date}`);
        if (tsRes.ok) {
          const timesheets: Array<{ employeeId: number; employeeName: string; unitId: number; unitName: string; rosteredStart: string | null; rosteredEnd: string | null; actualStart: string | null }> = await tsRes.json();
          const rosterEmpIds = new Set(rosters.map(r => r.employeeId));
          for (const ts of timesheets) {
            if (rosterEmpIds.has(ts.employeeId)) continue; // already in roster
            if (!ts.actualStart) continue; // not clocked in
            // Inject as synthetic roster entry using rostered or actual times
            rosters.push({
              employeeId:   ts.employeeId,
              employeeName: ts.employeeName,
              startTime:    ts.rosteredStart || ts.actualStart || '',
              endTime:      ts.rosteredEnd   || '',
              unitId:       ts.unitId,
              unitName:     ts.unitName,
            });
          }
        }
      } catch { /* non-fatal */ }

      const leaveSet    = new Set(leaveUnitIds);
      const floatSet    = new Set(floatUnitIds);
      const nonRatioSet = new Set(nonRatioUnitIds);

      const issSet        = new Set(issUnitIds);
      const leaveRosters:   RosteredStaff[] = rosters.filter(r => leaveSet.has(r.unitId));
      // Split-shift floats go to support — they don't cover the 10am-2pm window continuously.
      // Director can still manually drag them to float if needed.
      const floatRosters:   FloatStaff[]    = rosters.filter(r => floatSet.has(r.unitId) && !r.isSplitShift);
      // Split shift: keep ALL segments in support so each can be planned via Plan Day separately
      const splitShiftFloats: RosteredStaff[] = rosters.filter(r => floatSet.has(r.unitId) && r.isSplitShift);
      const issRosters:     FloatStaff[]    = rosters.filter(r => issSet.has(r.unitId));
      const supportRosters: RosteredStaff[] = [
        ...rosters.filter(r => nonRatioSet.has(r.unitId)),
        ...splitShiftFloats,  // one entry per segment so each shift can be planned separately
      ];

      setOnLeave(leaveRosters);
      setFloats(floatRosters);
      setIssStaff(issRosters);
      setSupportStaff(supportRosters);
      // Exclude leave staff so Staff Available only counts staff actually on shift
      setAllRosters(rosters.filter(r => !leaveSet.has(r.unitId)));

      // Current Sydney time in minutes for shift filtering
      const nowSydney = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
      const nowMinsToday = nowSydney.getHours() * 60 + nowSydney.getMinutes();

      // Build room statuses — always with showCurrentOnly=false so we store the
      // complete day's data. effectiveRoomStatuses re-applies the mode filter live.
      //
      // For future dates: if the room-forecast has an expected count for a room,
      // trim the historical childRows to that count so ratios use expected numbers.
      // We keep the age distribution from the historical cohort (sorted youngest-first
      // so the most conservative/youngest ages are preserved for ratio purposes).
      const statuses: RoomRatioStatus[] = centre.rooms.map(room => {
        const roomStaff = rosters.filter(r => r.unitId === room.deputyUnitId);
        let roomChildren = childRows;
        if (isFutureDate && forecastRes?.rooms) {
          // Find the forecast entry for this room (ownaRoomName substring match)
          const owna = (room.ownaRoomName ?? room.name).toLowerCase();
          const forecastEntry = Object.entries(forecastRes.rooms as Record<string, { expected: number | null; booked?: number | null }>)
            .find(([roomName]) => roomName.toLowerCase().includes(owna) || owna.includes(roomName.toLowerCase()));
          const expectedCount = forecastEntry?.[1]?.expected;
          if (expectedCount != null) {
            // Filter to this room's children then trim to expected count
            // Sort youngest first so conservative ratio ages are kept
            const roomKids = childRows
              .filter(ch => ch.room.toLowerCase().includes(owna))
              .sort((a, b) => (a.ageMonths ?? 999) - (b.ageMonths ?? 999))
              .slice(0, expectedCount);
            // Replace this room's children in the full array with the trimmed set
            const otherKids = childRows.filter(ch => !ch.room.toLowerCase().includes(owna));
            roomChildren = [...otherKids, ...roomKids];
          }
        }
        return buildRoomStatus(room, roomChildren, roomStaff, false, nowMinsToday);
      });

      // Sanity check: also flag rooms whose unit IDs got no rosters
      setRoomStatuses(statuses);
      setLastUpdated(new Date());

      // Fetch internal casual flags from WWCC table (best-effort, non-blocking)
      fetch('/api/staff-wwcc')
        .then(r => r.ok ? r.json() : [])
        .then((records: { full_name: string; is_internal_casual?: boolean }[]) => {
          const normName = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim();
          const casualSet = new Set<string>();
          for (const rec of records) {
            if (rec.is_internal_casual) casualSet.add(normName(rec.full_name));
          }
          setInternalCasualSet(casualSet);
        })
        .catch(() => {});

      // Fetch external casuals from Z Staffing (best-effort, non-blocking)
      // Use the centre name from config (strip leading 'The Grove Academy' prefix for API)
      const centreName = (() => {
        const c = CENTRES.find(c => c.id === selectedCentreId);
        if (!c) return null;
        // Strip common prefix so it matches TGA_WORKSPACE_MAP keys in the API
        return c.name
          .replace(/^The Grove Academy\s*[-–]?\s*/i, '')
          .replace(/^The Grove Academy$/i, 'Wollongong') // fallback
          .trim();
      })();
      if (centreName) {
        fetch(`/api/z-casuals?centre=${encodeURIComponent(centreName)}&date=${date}`)
          .then(r => r.ok ? r.json() : [])
          .then((records: {
            zJobId: string; name: string; start: string; end: string;
            status: string; certLevel: string; costCents: number; workspaceId: string;
          }[]) => {
            // Convert Z Staffing records to synthetic RosteredStaff
            // Use negative IDs derived from job ID hash to avoid Deputy collisions
            const toNegId = (s: string) => {
              let h = 0;
              for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
              return h < 0 ? h : -h;
            };
            const ecStaff: RosteredStaff[] = records.map(r => ({
              employeeId:   toNegId(r.zJobId),
              employeeName: r.name,
              startTime:    r.start,
              endTime:      r.end,
              unitId:       0,
              unitName:     'Z Casual',
              isExternalCasual: true,
              externalCasualMeta: {
                zJobId:      r.zJobId,
                certLevel:   r.certLevel,
                costCents:   r.costCents,
                status:      r.status,
                workspaceId: r.workspaceId,
              } as ExternalCasualMeta,
            }));
            setExternalCasuals(ecStaff);
          })
          .catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [date, effectiveDate, viewMode, selectedCentreId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load + refresh every 5 minutes
  useEffect(() => {
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  // Current Sydney time in minutes — used for snapshot staff filtering
  const nowSydneyRender = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const nowMinsRender = nowSydneyRender.getHours() * 60 + nowSydneyRender.getMinutes();
  function isOnShiftNow(s: RosteredStaff): boolean {
    const start = toMins(s.startTime);
    const end   = toMins(s.endTime);
    if (start === null) return true;
    const effectiveEnd = (end === null || end === 0) ? 24 * 60 : end;
    return start <= nowMinsRender && effectiveEnd > nowMinsRender;
  }

  // Derived summary stats
  // In "Currently Present" (snapshot) mode: filter everything to right now
  // In "All Day" mode: show full-day totals
  const totalChildren = children.filter(c => showCurrentOnly ? (c.sign_in && !c.sign_out) : c.sign_in).length;
  const summaryFloatCount   = showCurrentOnly ? effectiveFloats.filter(isOnShiftNow).length   : effectiveFloats.length;
  const summarySupportCount = showCurrentOnly ? effectiveSupportStaff.filter(isOnShiftNow).length : effectiveSupportStaff.length;
  const totalStaff = effectiveRoomStatuses.reduce((s, r) => s + r.staffCount, 0) + summaryFloatCount + summarySupportCount;
  const roomsAtRisk    = effectiveRoomStatuses.filter(r => r.status === 'red');
  const overallStatus  = roomsAtRisk.length > 0 ? 'red' : 'green';

  return (
    <Layout>
      <style>{`
        @media (max-width: 1024px) {
          .ratio-check-table { font-size: 11px; }
          button { min-height: 36px; }
          [draggable] { user-select: none; -webkit-user-select: none; }
        }
        @media (hover: none) and (pointer: coarse) {
          [draggable] { touch-action: none; }
        }
      `}</style>
      {/* -- Header -- */}
      {/* Mode indicator */}
      {viewMode === 'expected' && (
        <div style={{ margin: '0 0 8px', padding: '6px 12px', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', fontSize: '12px', color: '#92400e' }}>
          Expected view — showing predicted attendance from {effectiveDate} (same weekday last week)
        </div>
      )}
      {viewMode !== 'expected' && date > todayStr() && (
        <div style={{ margin: '0 0 8px', padding: '6px 12px', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', fontSize: '12px', color: '#92400e' }}>
          Future date — no actual attendance yet. Using {effectiveDate} (same weekday last week) as a prediction.
        </div>
      )}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight" style={{ color: '#2d5c18' }}>
            Ratio Dashboard
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#596570' }}>
            {centre.name} · {safeFormat(new Date(date + 'T12:00:00Z'), 'EEEE d MMMM yyyy')}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            {effectiveDate !== date ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                {date > todayStr() ? '📅 Predicted from' : '📊 Expected mode from'} {effectiveDate}
              </span>
            ) : ownaRefreshedAt ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                🌿 Owna data as of {format(ownaRefreshedAt, 'h:mm a')}
              </span>
            ) : lastUpdated ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: '#f1f5f9', color: '#64748b' }}>
                Page loaded {format(lastUpdated, 'h:mm:ss a')}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Centre selector */}
          {availableCentres.length > 1 && (
            <select
              value={selectedCentreId}
              onChange={e => handleCentreChange(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm font-medium"
              style={{ borderColor: '#c0d0c0', color: '#2d5c18', backgroundColor: 'white' }}
            >
              {availableCentres.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {/* Date navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const d = new Date(date + 'T12:00:00Z');
                d.setDate(d.getDate() - 1);
                setDate(d.toISOString().slice(0, 10));
              }}
              className="border rounded-xl px-3 py-2 text-sm font-semibold transition-colors hover:bg-gray-50"
              style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
              title="Previous day"
            >×</button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm font-medium"
              style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
            />
            <button
              onClick={() => {
                const d = new Date(date + 'T12:00:00Z');
                d.setDate(d.getDate() + 1);
                setDate(d.toISOString().slice(0, 10));
              }}
              disabled={date >= todayStr()}
              className="border rounded-xl px-3 py-2 text-sm font-semibold transition-colors hover:bg-gray-50 disabled:opacity-30"
              style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
              title="Next day"
            >×</button>
          </div>
          {/* Summary link */}
          <button
            onClick={() => navigate('/summary')}
            className="border rounded-xl px-4 py-2 text-sm font-semibold transition-colors"
            style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
          >
            All Centres
          </button>
          {/* Refresh */}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-4 py-2 rounded-xl font-medium text-sm text-white transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#2d5c18' }}
          >
            {loading ? '⏳ Loading…' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* -- View tabs -- */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setActiveView('plan-of-day')}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={activeView === 'plan-of-day'
            ? { backgroundColor: '#2d5c18', color: 'white' }
            : { backgroundColor: 'white', color: '#2d5c18', border: '1px solid #c0d0c0' }}
        >Plan of the Day</button>
        <button
          onClick={() => setActiveView('ratio-check')}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={activeView === 'ratio-check'
            ? { backgroundColor: '#2d5c18', color: 'white' }
            : { backgroundColor: 'white', color: '#2d5c18', border: '1px solid #c0d0c0' }}
        >Ratio Check</button>
        <button
          onClick={() => setActiveView('summary')}
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={activeView === 'summary'
            ? { backgroundColor: '#2d5c18', color: 'white' }
            : { backgroundColor: 'white', color: '#2d5c18', border: '1px solid #c0d0c0' }}
        >🗒️ Summary</button>
      </div>

      {/* -- Lunch overdue alerts — shown across all tabs -- */}
      {!isFutureDate && lunchAlerts.length > 0 && (
        <div className="no-print mb-4 rounded-xl border p-3" style={{ borderColor: '#fcd34d', backgroundColor: '#fffbeb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '15px' }}>🍝</span>
            <span style={{ fontWeight: 700, fontSize: '13px', color: '#92400e' }}>
              Lunch break overdue — {lunchAlerts.length} staff member{lunchAlerts.length !== 1 ? 's' : ''} haven't started their break
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {lunchAlerts.map(a => (
              <span key={a.employeeId} style={{
                fontSize: '12px', padding: '3px 8px', borderRadius: '6px',
                backgroundColor: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e',
              }}>
                {a.employeeName.split(' ')[0]} — scheduled {a.scheduledLunch} ({a.minutesOverdue}m overdue)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* -- Ratio Check Panel -- */}
      {activeView === 'ratio-check' && (
        <div
          className="rounded-2xl border shadow-sm p-5 mb-6"
          style={{ borderColor: '#e0e8e0', backgroundColor: 'white' }}
        >
          <RatioCheckPanel
            centreId={selectedCentreId}
            date={date}
            rooms={centre.rooms}
            children={children}
            rosters={allRosters.filter(r => !leaveUnitIds.includes(r.unitId))}
            onLunchAlerts={setLunchAlerts}
          />
        </div>
      )}

      {/* —— Summary tab —— */}
      {activeView === 'summary' && (
        <SummaryTab
          centreId={selectedCentreId}
          date={date}
          rooms={centre.rooms}
          allRosters={allRosters}
          staffMoves={staffMoves}
          floatUnitIds={floatUnitIds}
          leaveUnitIds={leaveUnitIds}
          issUnitIds={issUnitIds}
          nonRatioUnitIds={nonRatioUnitIds}
        />
      )}

      {/* Attendance overview — Plan of the Day */}
      {activeView === 'plan-of-day' && (<>
      {/* -- Plan / Live sub-tabs (hidden for future dates — always all-day) -- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        {!isFutureDate && (
          <div style={{ display: 'flex' }}>
            <button onClick={() => setPlanSubView('plan')}
              style={{ padding: '6px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                backgroundColor: planSubView === 'plan' ? '#0369a1' : 'white',
                color: planSubView === 'plan' ? 'white' : '#0369a1',
                border: '1px solid #0369a1', borderRadius: '8px 0 0 8px' }}
            >All Day</button>
            <button onClick={() => setPlanSubView('live')}
              style={{ padding: '6px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                backgroundColor: planSubView === 'live' ? '#0369a1' : 'white',
                color: planSubView === 'live' ? 'white' : '#0369a1',
                border: '1px solid #0369a1', borderRadius: '0 8px 8px 0' }}
            >Currently Present</button>
          </div>
        )}
        {isFutureDate && (
          <span style={{ fontSize: '11px', borderRadius: '4px', padding: '2px 8px',
            color: '#1d4ed8', backgroundColor: '#dbeafe', border: '1px solid #93c5fd' }}>
            📅 Expected attendance based on historical patterns · {new Date(date + 'T12:00:00+10:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
        {!isFutureDate && planSubView === 'plan' && (
          <span style={{ fontSize: '11px', borderRadius: '4px', padding: '2px 8px',
            color: effectiveDate !== date ? '#92400e' : '#166534',
            backgroundColor: effectiveDate !== date ? '#fef3c7' : '#dcfce7',
            border: effectiveDate !== date ? '1px solid #fcd34d' : '1px solid #86efac',
          }}>
            {effectiveDate !== date
              ? `📅 Predicted from ${effectiveDate} (same weekday last week)`
              : '✅ Actual Owna data'}
          </span>
        )}
        {!isFutureDate && planSubView === 'live' && (
          <span style={{ fontSize: '11px', color: '#166534', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '4px', padding: '2px 8px' }}>
            👁️ Snapshot · right now
          </span>
        )}
      </div>


      {/* -- Error -- */}
      {error && (
        <div
          className="rounded-xl p-4 mb-5 text-sm font-medium"
          style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* -- Summary bar -- */}
      <div
        className="rounded-2xl p-5 mb-6 shadow-sm"
        style={{ backgroundColor: '#2d5c18' }}
      >
        <div className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: '#E2F1DA' }}>
          Centre Summary
        </div>
        <div className="flex gap-3">
          {/* Total children */}
          <div className="flex-1 rounded-xl p-2" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-base mb-0.5">👶</div>
            {loading ? (
              <SkeletonPulse className="h-6 w-10 bg-white/20 mb-1" />
            ) : (
              <div className="text-lg font-bold text-white leading-tight">{totalChildren}</div>
            )}
            <div className="text-xs" style={{ color: '#E2F1DA' }}>
              {showCurrentOnly ? 'Currently present' : isFutureDate ? 'Expected' : 'Attended today'}
            </div>
          </div>

          {/* Booked */}
          {forecast?.booked != null && (
            <div className="flex-1 rounded-xl p-2" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <div className="text-base mb-0.5">📋</div>
              {loading ? (<SkeletonPulse className="h-6 w-10 bg-white/20 mb-1" />) : (<div className="text-lg font-bold text-white leading-tight">{forecast.booked}</div>)}
              <div className="text-xs" style={{ color: '#E2F1DA' }}>Booked</div>
            </div>
          )}
          {/* Total staff */}
          <div className="flex-1 rounded-xl p-2" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-base mb-0.5">👤</div>
            {loading ? (
              <SkeletonPulse className="h-6 w-10 bg-white/20 mb-1" />
            ) : (
              <div className="text-lg font-bold text-white leading-tight">{totalStaff}</div>
            )}
            <div className="text-xs" style={{ color: '#E2F1DA' }}>
              {showCurrentOnly ? 'Currently on shift' : 'Staff rostered'}
            </div>
          </div>

          {/* Rooms at risk */}
          <div className="flex-1 rounded-xl p-2" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-base mb-0.5">🚨</div>
            {loading ? (
              <SkeletonPulse className="h-6 w-10 bg-white/20 mb-1" />
            ) : (
              <div className="text-lg font-bold leading-tight" style={{ color: roomsAtRisk.length > 0 ? '#fca5a5' : '#E2F1DA' }}>
                {roomsAtRisk.length}
              </div>
            )}
            <div className="text-xs" style={{ color: '#E2F1DA' }}>Rooms at risk</div>
          </div>

          {/* Overall status */}
          <div className="flex-1 rounded-xl p-2" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-base mb-0.5">🟦</div>
            {loading ? (
              <SkeletonPulse className="h-8 w-20 bg-white/20 mb-1" />
            ) : (
              <div
                className="text-sm font-bold leading-tight"
                style={{ color: overallStatus === 'green' ? '#E2F1DA' : '#fca5a5' }}
              >
                {overallStatus === 'green' ? '✅ Compliant' : '⚠️ Action needed'}
              </div>
            )}
            <div className="text-xs" style={{ color: '#E2F1DA' }}>Overall status</div>
          </div>
        </div>
      </div>

      {/* -- Room cards grid -- */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {centre.rooms.map(r => (
            <div key={r.id} className="rounded-2xl border overflow-hidden" style={{ borderColor: '#e0e8e0' }}>
              <div className="p-4 space-y-2" style={{ backgroundColor: '#f5f7f5' }}>
                <SkeletonPulse className="h-5 w-32" />
                <SkeletonPulse className="h-4 w-20" />
              </div>
              <div className="p-4 space-y-3">
                <SkeletonPulse className="h-8 w-16" />
                <SkeletonPulse className="h-4 w-full" />
                <SkeletonPulse className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
        {/* Drag-and-drop toolbar */}
        {hasOverrides ? (
          <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-xl flex-wrap gap-2" style={{ backgroundColor: '#F5FAF3', border: '1px solid #c6e0c6' }}>
            <span className="text-xs font-semibold" style={{ color: '#2d5c18' }}>
              ✅ Reallocation active — {safeFormat(new Date(date + 'T12:00:00Z'), 'd MMM yyyy')}
              {movesSaved && !saveFlash && <span style={{ color: '#16a34a' }}> · ✔️ Saved</span>}
            </span>
            <div className="flex items-center gap-2">
              {saveFlash && <span className="text-xs font-semibold" style={{ color: '#16a34a' }}>✅ Saved for today!</span>}
              {!movesSaved && (
                <button
                  onClick={saveMoves}
                  className="text-xs font-semibold px-3 py-1 rounded-lg"
                  style={{ backgroundColor: '#5a9228', color: 'white' }}
                >
                  💾 Save for {safeFormat(new Date(date + 'T12:00:00Z'), 'd MMM')}
                </button>
              )}
              <button onClick={resetMoves} className="text-xs font-semibold px-3 py-1 rounded-lg" style={{ backgroundColor: '#A0D083', color: 'white' }}>Reset</button>
            </div>
          </div>
        ) : (
          <div className="text-xs mb-3" style={{ color: '#596570' }}>📌 Drag staff chips between rooms to plan reallocations — saves per day</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {effectiveRoomStatuses.map(rs => {
            // Build movedIn/movedOut maps for this room
            const movedInFrom = new Map<number, string>();
            const movedOutIds = new Set<number>();
            if (hasOverrides) {
              rs.rosteredStaff.forEach(s => {
                const destId = staffMoves[s.employeeId];
                if (destId && destId !== rs.room.id) movedOutIds.add(s.employeeId);
                // Check if this staff came from somewhere else
                const origRs = roomStatuses.find(r => r.rosteredStaff.some(x => x.employeeId === s.employeeId));
                if (origRs && origRs.room.id !== rs.room.id) {
                  movedInFrom.set(s.employeeId, origRs.room.name);
                }
                // Could be from float pool or ISS pool
                if (!origRs) {
                  const isIss = issStaff.some(is => is.employeeId === s.employeeId);
                  movedInFrom.set(s.employeeId, isIss ? 'ISS Pool' : 'Float Pool');
                }
              });
            }
            return (
              <RoomCard
                key={rs.room.id}
                roomStatus={rs}
                issAssigned={issStaff.filter(s => staffMoves[s.employeeId] === rs.room.id)}
                forecast={forecast?.rooms ? (() => {
                  const owna = (rs.room.ownaRoomName ?? rs.room.name).toLowerCase();
                  const match = Object.entries(forecast.rooms).find(([k]) => k.toLowerCase().includes(owna) || owna.includes(k.toLowerCase()));
                  return match ? match[1] : null;
                })() : null}
                drag={{
                  onDragStart,
                  onDragOver,
                  onDragLeave,
                  onDrop,
                  isDragOver: dropTarget === rs.room.id,
                  movedInFrom,
                  movedOutIds,
                }}
              />
            );
          })}
        </div>
      {/* -- Float pool + Support staff -- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Float pool */}
        {loading ? (
          <div className="rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
            <SkeletonPulse className="h-5 w-32 mb-3" />
            <SkeletonPulse className="h-8 w-full mb-2" />
            <SkeletonPulse className="h-8 w-3/4" />
          </div>
        ) : (
          <FloatPoolSection
              floats={effectiveFloats}
              onLeave={onLeave}
              roomStatuses={effectiveRoomStatuses}
              totalChildren={children.length}
              children={children}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              isDragOver={dropTarget === 'float'}
              onFloatClick={f => setScheduledFloat(f)}
              savedFloatIds={savedFloatIds}
              adStaff={adStaff}
              externalCasuals={externalCasuals}
            />
        )}

        
        {/* ISS — Inclusion Support Staff */}
        {loading ? (
          <div className="rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
            <SkeletonPulse className="h-5 w-40 mb-3" />
            <SkeletonPulse className="h-8 w-full mb-2" />
            <SkeletonPulse className="h-8 w-3/4" />
          </div>
        ) : issStaff.length > 0 && (
          <div
            className="rounded-2xl border shadow-sm overflow-hidden"
            style={{ borderColor: dropTarget === 'iss' ? '#3b82f6' : '#dbeafe', backgroundColor: 'white', borderWidth: dropTarget === 'iss' ? 2 : 1, borderStyle: dropTarget === 'iss' ? 'dashed' : 'solid' }}
            onDragOver={e => onDragOver(e, 'iss')}
            onDragLeave={onDragLeave}
            onDrop={e => onDrop(e, 'iss')}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: '#eff6ff' }}>
              <div>
                <div className="font-bold text-sm" style={{ color: '#1d4ed8' }}>Support Staff (ISS)</div>
                <div className="text-xs mt-0.5" style={{ color: '#3b82f6' }}>
                  {effectiveIssStaff.length} unassigned{issDeployed.length > 0 && ` · ${issDeployed.length} deployed`}
                </div>
              </div>
              <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>ISS</span>
            </div>
            <div className="px-4 pt-2 pb-1">
              <p className="text-xs" style={{ color: '#64748b' }}>
                Drag to a <strong>room</strong> to count toward ratio, or use the dropdown to assign.
              </p>
            </div>
            <div className="px-4 pb-3 space-y-1.5 mt-1">
              {effectiveIssStaff.length === 0 && issDeployed.length === 0 ? (
                <p className="text-xs italic" style={{ color: '#94a3b8' }}>No ISS staff today</p>
              ) : effectiveIssStaff.map(s => (
                <div
                  key={s.employeeId + '-' + s.startTime + '-iss'}
                  draggable
                  onDragStart={e => onDragStart(e, s, 'iss')}
                  className="flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing"
                >
                  <StaffChip staff={s} />
                  <select
                    value="iss"
                    onChange={e => {
                      const val = e.target.value;
                      if (val === 'iss') {
                        const next = { ...staffMoves };
                        delete next[s.employeeId];
                        setStaffMoves(next);
                      } else {
                        setStaffMoves(prev => ({ ...prev, [s.employeeId]: val }));
                      }
                    }}
                    className="text-xs rounded-lg border px-1.5 py-1 shrink-0"
                    style={{ borderColor: '#dbeafe', color: '#1d4ed8', backgroundColor: 'white', maxWidth: '110px' }}
                  >
                    <option value="iss">ISS pool</option>
                    {centre.rooms.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              ))}
              {/* Deployed ISS staff — show where each person has been assigned */}
              {issDeployed.length > 0 && (
                <div className={effectiveIssStaff.length > 0 ? 'mt-2 pt-2 border-t' : ''} style={{ borderColor: '#e0e7ff' }}>
                  {issDeployed.length > 0 && effectiveIssStaff.length > 0 && (
                    <p className="text-xs font-semibold mb-1" style={{ color: '#6366f1' }}>Deployed:</p>
                  )}
                  {issDeployed.map(({ staff: s, destLabel }) => (
                    <div key={s.employeeId + '-deployed'} className="flex items-center justify-between gap-2 py-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <StaffChip staff={s} />
                        <span className="text-xs font-semibold shrink-0 px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: '#ede9fe', color: '#6d28d9', fontSize: '10px' }}>
                          → {destLabel}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          const next = { ...staffMoves };
                          delete next[s.employeeId];
                          setStaffMoves(next);
                          setMovesSaved(false);
                        }}
                        className="text-xs px-2 py-0.5 rounded-lg border shrink-0"
                        style={{ borderColor: '#dbeafe', color: '#6366f1' }}
                      >
                        Return to ISS
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Support staff */}
        {loading ? (
          <div className="rounded-2xl border p-4" style={{ borderColor: '#e0e8e0' }}>
            <SkeletonPulse className="h-5 w-40 mb-3" />
            <SkeletonPulse className="h-8 w-full mb-2" />
            <SkeletonPulse className="h-8 w-3/4" />
          </div>
        ) : (
          <div
            className="rounded-2xl border shadow-sm overflow-hidden transition-all"
            style={{
              borderColor:  dropTarget === 'support' ? '#5a9228' : '#e0e8e0',
              borderWidth:  dropTarget === 'support' ? 2 : 1,
              borderStyle:  dropTarget === 'support' ? 'dashed' : 'solid',
              backgroundColor: dropTarget === 'support' ? '#f0f9f0' : 'white',
            }}
            onDragOver={e => onDragOver(e, 'support')}
            onDragLeave={onDragLeave}
            onDrop={e => onDrop(e, 'support')}
          >
            <div className="px-4 py-3" style={{ backgroundColor: '#F5FAF3' }}>
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm" style={{ color: '#2d5c18' }}>Support Staff</div>
                {dropTarget === 'support' && <span className="text-xs font-semibold" style={{ color: '#2d5c18' }}>Drop to return to support</span>}
              </div>
              <div className="text-xs opacity-60" style={{ color: '#2d5c18' }}>
                {effectiveSupportStaff.length} staff · Directors, Ed Leaders, Admin &amp; more
              </div>
            </div>
            <div className="px-4 py-3">
              {effectiveSupportStaff.length > 0 ? (
                <div className="space-y-0">
                  {effectiveSupportStaff.map(s => (
                    <div
                      key={`${s.employeeId}-${s.unitId}-${s.startTime}`}
                      draggable
                      onDragStart={e => onDragStart(e, s, 'support')}
                      className="cursor-grab active:cursor-grabbing flex items-center justify-between"
                    >
                      <StaffChip staff={s} />
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        {/* Split-shift staff get a Plan Day button so directors can schedule their day */}
                        {s.isSplitShift && (
                          <button
                            onClick={() => setScheduledFloat(s as FloatStaff)}
                            className="text-xs px-2 py-0.5 rounded-full font-medium hover:opacity-80"
                            style={{ backgroundColor: savedFloatIds.has(s.employeeId) ? '#bbf7d0' : '#E2F1DA', color: '#2d5c18' }}
                          >
                            {savedFloatIds.has(s.employeeId) ? '✅ Day Planned' : '📋 Plan day'}
                          </button>
                        )}
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: '#F5FAF3', color: '#2d5c18' }}
                        >
                          {s.unitName || 'Support'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm italic py-1" style={{ color: dropTarget === 'support' ? '#5a9228' : '#9ca3af' }}>
                  {dropTarget === 'support' ? 'Drop staff here' : 'No support staff rostered today'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </>
      )}


      {/* -- Float Schedule (unified coverage plan) -- */}
      {!loading && (effectiveFloats.length > 0 || effectiveIssStaff.length > 0) && (
        <FloatBreakPanel
          centreId={selectedCentreId}
          date={date}
          floats={effectiveFloats}
          issStaff={effectiveIssStaff}
        />
      )}

      {/* -- Predicted coverage panel (future dates only) -- */}
      {!loading && date > todayStr() && children.length > 0 && (
        <PredictedCoveragePanel
          rooms={centre.rooms}
          children={children}
          allRosters={allRosters}
          floats={floats}
          adStaff={adStaff}
          effectiveDate={effectiveDate}
          targetDate={date}
        />
      )}

      {/* -- Lunch Break Plan (room staff breaks) -- */}
      {!loading && roomStatuses.length > 0 && (
        <div className="mb-6">
          <LunchBreakPanel
            key={lunchReloadKey}
            centreId={selectedCentreId}
            date={date}
            roomStatuses={effectiveRoomStatuses}
            floats={effectiveFloats}
            issStaff={effectiveIssStaff}
            staffMoves={staffMoves}
            supportStaff={supportStaff}
            approvedPlaces={centre.approvedPlaces}
          />
        </div>
      )}

      {/* -- Day timeline -- */}
      {!loading && roomStatuses.length > 0 && (
        <div
          className="rounded-2xl border overflow-hidden shadow-sm mb-6"
          style={{ borderColor: '#e0e8e0' }}
        >
          <div className="px-4 py-3" style={{ backgroundColor: '#F5FAF3' }}>
            <div className="font-bold text-sm" style={{ color: '#2d5c18' }}>Day Timeline — All Rooms</div>
            <div className="text-xs mt-0.5" style={{ color: '#596570' }}>
              Total children present vs total staff required vs rostered — 15-min intervals
            </div>
          </div>
          <div className="px-4 pt-3 pb-4">
            <RatioTimeline
              rooms={centre.rooms}
              children={children as any}
              allRosteredStaff={effectiveRoomStatuses.flatMap(rs => rs.rosteredStaff)}
              peakHourStaff={[
                // Only floaters count in the peak-hour windows (7–9am / 4–6pm)
                // Support staff (chefs, admin, ed leaders) are excluded from the timeline
                // to avoid inflating the actual-staff line with non-ratio personnel
                ...effectiveFloats,
              ]}
              date={date}
            />
          </div>
        </div>
      )}
      {/* -- Float schedule panel -- */}
      {scheduledFloat && (
        <FloatSchedulePanel
          float={scheduledFloat}
          centreId={selectedCentreId}
          date={date}
          rooms={centre.rooms}
          roomStatuses={effectiveRoomStatuses}
          children={children}
          historicalDate={planSubView === 'plan' && effectiveDate !== date ? effectiveDate : undefined}
          onClose={() => setScheduledFloat(null)}
          onSaved={(_schedule: FloatSchedule) => {
            setScheduledFloat(null);
            setSavedFloatIds(prev => new Set([...prev, _schedule.employeeId]));
            setLunchReloadKey(k => k + 1);
          }}
        />
      )}
      </>
      )}
    </Layout>
  );
}
