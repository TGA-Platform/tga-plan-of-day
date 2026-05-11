/**
 * timeline.ts
 * Builds 15-minute interval slots for the staffing timeline
 */

import type { AttendanceRecord } from '../api/ownaData';
import type { RosteredStaff } from '../types';

export interface TimeSlot {
  start: Date;
  end: Date;
  label: string; // "6:00 AM", "6:15 AM", etc.
  hour: number;
  minute: number;
}

export interface RoomTimeSlot extends TimeSlot {
  signedIn: number;
  anticipated: number;
  rostered: number;
  required: number;
  status: 'green' | 'amber' | 'red' | 'empty';
}

/** Generate 15-min slots from 6:00am to 6:30pm */
export function generateTimeSlots(date: string): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const startHour = 6;
  const endHour = 18; // 6pm
  const endMinute = 30; // 6:30pm

  for (let hour = startHour; hour <= endHour; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      if (hour === endHour && minute > endMinute) break;
      if (hour === endHour && minute === endMinute) break;
      
      const start = new Date(`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+10:00`);
      const end = new Date(start.getTime() + 15 * 60 * 1000);
      
      const period = hour < 12 ? 'AM' : 'PM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const label = `${displayHour}:${String(minute).padStart(2,'0')} ${period}`;
      
      slots.push({ start, end, label, hour, minute });
    }
  }
  
  return slots;
}

/** 
 * For a given room and time slot, count how many signed-in children are present
 * A child is present in slot if: sign_in <= slot_start AND (sign_out >= slot_end OR sign_out IS NULL)
 */
export function countPresentInSlot(
  records: AttendanceRecord[],
  slotStart: Date,
  _slotEnd: Date
): number {
  return records.filter(r => {
    if (!r.sign_in) return false;
    const signIn = new Date(r.sign_in);
    const signOut = r.sign_out ? new Date(r.sign_out) : null;
    // Child is present if they signed in before or at slot start,
    // and either haven't signed out yet, or signed out after slot start
    return signIn <= slotStart && (signOut === null || signOut >= slotStart);
  }).length;
}

/** Count rostered staff for a given unit who are working during a time slot */
export function countRosteredInSlot(
  rosters: RosteredStaff[],
  unitId: number,
  slotStart: Date,
  slotEnd: Date
): number {
  const unitRosters = rosters.filter(r => r.unitId === unitId);
  
  let count = 0;
  const seen = new Set<number>();
  
  for (const staff of unitRosters) {
    if (seen.has(staff.employeeId)) continue;
    
    if (!staff.startTime || !staff.endTime) {
      seen.add(staff.employeeId);
      count++;
      continue;
    }
    
    try {
      // Parse Deputy time format (Unix timestamps or time strings)
      let start: Date, end: Date;
      
      if (typeof staff.startTime === 'number') {
        start = new Date(staff.startTime * 1000);
        end = new Date((staff.endTime as unknown as number) * 1000);
      } else {
        // Try to parse as ISO or Unix timestamp string
        const startTs = parseInt(staff.startTime);
        const endTs = parseInt(staff.endTime);
        
        if (!isNaN(startTs) && startTs > 1000000000) {
          // Unix timestamp
          start = new Date(startTs * 1000);
          end = new Date(endTs * 1000);
        } else {
          // Time string like "08:00:00" - combine with date
          const dateStr = slotStart.toISOString().split('T')[0];
          start = new Date(`${dateStr}T${staff.startTime}+10:00`);
          end = new Date(`${dateStr}T${staff.endTime}+10:00`);
        }
      }
      
      // Staff is rostered if their shift overlaps with this slot
      if (start < slotEnd && end > slotStart) {
        seen.add(staff.employeeId);
        count++;
      }
    } catch {
      // If we can't parse the time, count them (benefit of the doubt)
      seen.add(staff.employeeId);
      count++;
    }
  }
  
  return count;
}

export function getSlotStatus(
  rostered: number,
  required: number,
  hasChildren: boolean
): 'green' | 'amber' | 'red' | 'empty' {
  if (!hasChildren || required === 0) return 'empty';
  if (rostered >= required) return 'green';
  if (rostered >= required - 1) return 'amber';
  return 'red';
}

/** 
 * Build complete room timeline slots with staffing analysis
 */
export function buildRoomTimeline(
  date: string,
  records: AttendanceRecord[],
  rosters: RosteredStaff[],
  unitId: number,
  ratio: number,
  anticipatedChildren: number,
  excludeRoleIds?: Set<number>
): RoomTimeSlot[] {
  const slots = generateTimeSlots(date);
  
  // Filter rosters if certain roles excluded
  const filteredRosters = excludeRoleIds
    ? rosters.filter(r => !excludeRoleIds.has(r.employeeId))
    : rosters;
  
  return slots.map(slot => {
    const signedIn = countPresentInSlot(records, slot.start, slot.end);
    // Use signedIn if available, otherwise use anticipated
    const children = signedIn > 0 ? signedIn : anticipatedChildren > 0 ? anticipatedChildren : 0;
    const required = children > 0 ? Math.ceil(children / ratio) : 0;
    const rostered = countRosteredInSlot(filteredRosters, unitId, slot.start, slot.end);
    const status = getSlotStatus(rostered, required, children > 0);
    
    return {
      ...slot,
      signedIn,
      anticipated: anticipatedChildren,
      rostered,
      required,
      status,
    };
  });
}

/** Format a Date to "8:30 AM" style */
export function formatTimeLabel(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours < 12 ? 'AM' : 'PM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}:${String(minutes).padStart(2,'0')} ${period}`;
}
