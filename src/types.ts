export interface Room {
  id: string;
  name: string;
  ageGroup: string;
  ratio: number;
  deputyUnitId: number;
}

export interface Centre {
  id: string;
  name: string;
  rooms: Room[];
  deputyCompanyId?: number;
}

export interface User {
  email: string;
  role: 'ceo' | 'director';
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
