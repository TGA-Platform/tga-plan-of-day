import { DEFAULT_ATTENDANCE } from './config';

const STORAGE_KEY = 'tga_pod_attendance';

function loadOverrides(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveOverrides(overrides: Record<string, number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function getAttendance(date: string, roomId: string): number {
  const overrides = loadOverrides();
  const key = `${date}:${roomId}`;
  if (key in overrides) return overrides[key];
  return DEFAULT_ATTENDANCE[roomId] ?? 0;
}

export function setAttendance(date: string, roomId: string, value: number) {
  const overrides = loadOverrides();
  const key = `${date}:${roomId}`;
  overrides[key] = value;
  saveOverrides(overrides);
}

export function getStaffRequired(attendance: number, ratio: number): number {
  if (attendance === 0) return 0;
  return Math.ceil(attendance / ratio);
}

export function getStatus(staffRostered: number, staffRequired: number): 'green' | 'amber' | 'red' {
  if (staffRostered >= staffRequired) return 'green';
  if (staffRostered >= staffRequired - 1) return 'amber';
  return 'red';
}

export function formatTime(timeStr: string): string {
  if (!timeStr) return '';
  try {
    // Deputy times can be ISO or "HH:MM:SS"
    const date = new Date(timeStr);
    if (!isNaN(date.getTime())) {
      return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    // Try parsing HH:MM:SS
    return timeStr.substring(0, 5);
  } catch {
    return timeStr;
  }
}
