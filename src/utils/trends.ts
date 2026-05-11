/**
 * trends.ts
 * Applies trend factors to bookings to calculate anticipated attendance
 */

import type { TrendRecord } from '../api/ownaData';

const DEFAULT_RATE = 0.90; // Industry standard: 90% of booked children attend

/**
 * Get the day of week as 0=Mon, 1=Tue, ..., 4=Fri
 * Returns null for weekends
 */
export function getWeekdayIndex(date: string): number | null {
  const d = new Date(date + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun, 1=Mon
  if (dow === 0 || dow === 6) return null;
  return dow - 1; // Convert to 0=Mon
}

/**
 * Calculate anticipated attendance for a room on a given day
 * anticipated = Math.round(booked × trend_rate)
 */
export function anticipatedAttendance(
  bookedChildren: number,
  roomName: string,
  date: string,
  trends: TrendRecord[]
): number {
  const dow = getWeekdayIndex(date);
  if (dow === null) return 0;
  
  const trend = trends.find(t => t.room_name === roomName && t.day_of_week === dow);
  const rate = trend ? trend.avg_attendance_rate : DEFAULT_RATE;
  
  return Math.round(bookedChildren * rate);
}

/**
 * Get trend rate for a room on a given day
 */
export function getTrendRate(
  roomName: string,
  date: string,
  trends: TrendRecord[]
): number {
  const dow = getWeekdayIndex(date);
  if (dow === null) return DEFAULT_RATE;
  
  const trend = trends.find(t => t.room_name === roomName && t.day_of_week === dow);
  return trend ? trend.avg_attendance_rate : DEFAULT_RATE;
}

/**
 * Calculate how many casuals are needed for a room
 * Returns 0 if sufficiently staffed, positive number if understaffed
 */
export function casualsNeeded(
  rostered: number,
  anticipated: number,
  ratio: number
): number {
  const required = anticipated > 0 ? Math.ceil(anticipated / ratio) : 0;
  const diff = required - rostered;
  return Math.max(0, diff);
}

/**
 * Find peak understaffed period for a room
 * Returns { start, end, shortage } or null if no shortage
 */
export interface StaffingGap {
  startLabel: string;
  endLabel: string;
  shortage: number;
}

export function findPeakGap(
  roomSlots: Array<{ label: string; rostered: number; required: number; status: string }>
): StaffingGap | null {
  let maxShortage = 0;
  let gapStart: string | null = null;
  let gapEnd: string | null = null;
  
  for (const slot of roomSlots) {
    const shortage = Math.max(0, slot.required - slot.rostered);
    if (shortage > maxShortage) {
      maxShortage = shortage;
      gapStart = slot.label;
      gapEnd = slot.label;
    }
  }
  
  if (maxShortage === 0 || !gapStart) return null;
  return { startLabel: gapStart, endLabel: gapEnd!, shortage: maxShortage };
}

/** Format percentage for display */
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
