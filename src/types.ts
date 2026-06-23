export interface Room {
  id: string;
  name: string;
  ageGroup: string;
  ratio: number;
  deputyUnitId: number;
  ownaRoomName?: string; // Room name as it appears in Owna/Supabase attendance data
}

export interface Centre {
  id: string;
  name: string;
  ownaName?: string;    // Owna campus name if different from name (e.g. 'Ed Park 1' vs 'Edmondson Park 1')
  rooms: Room[];
  deputyCompanyId?: number;
  floatUnitIds?: number[];  // pure float pool (unallocated, available for ratio cover)
  issUnitIds?: number[];     // Inclusion Support Staff — shown separately, assignable to room or float
  leaveUnitIds?: number[];
  nonRatioUnitIds?: number[];
  approvedPlaces?: number;   // NSW approved places — ADs/Ed Leaders can cover lunch if < 100
  outdoorAreas?: string[];    // Configurable outdoor / non-room areas (e.g. 'Outdoor Area', 'Front Yard')
}

export interface User {
  email: string;
  role: 'admin' | 'ceo' | 'area_manager' | 'director'; // ceo kept for backward compat
  centreId: string;
  name: string;
}

export interface RosteredStaff {
  employeeId: number;
  employeeName: string;
  startTime: string;
  endTime: string;
  unitId: number;
  unitName: string;
  isInternalCasual?: boolean;
  isSplitShift?: boolean;  // true when employee has 2 roster entries with a gap ≥ 2 hours
  splitSegments?: { startTime: string; endTime: string }[]; // both segments for display
}

export interface AbsentStaff {
  employeeId: number;
  employeeName: string;
  reason: string;
}

export interface DayData {
  date: string;
  rosters: RosteredStaff[];
  absentStaff: AbsentStaff[];
}

export interface AttendanceOverride {
  [dateRoomKey: string]: number; // "2026-05-08:explorers" -> 12
}

export type StaffingStatus = 'green' | 'amber' | 'red';

export interface AttendanceChild {
  child_name: string;
  room: string;
  sign_in: string | null;
  sign_out: string | null;
  predicted_sign_out: string | null; // booked session end time
  age: string | null;    // e.g. "2y 3m"
  ageMonths: number;     // calculated
}

export interface RoomRatioStatus {
  room: Room;
  children: AttendanceChild[];
  presentCount: number;
  ageBreakdown: { bracket: string; count: number; ratio: number }[];
  requiredStaff: number;
  rosteredStaff: RosteredStaff[];
  staffCount: number;
  shortage: number;       // positive = need floats; negative = surplus
  status: 'green' | 'amber' | 'red';
}

export interface FloatStaff extends RosteredStaff {
  suggestedRoom?: string;
}
