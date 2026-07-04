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
  isExternalCasual?: boolean;  // Z Staffing casual — shown as EC badge
  externalCasualMeta?: ExternalCasualMeta; // extra data only on EC staff
  isSplitShift?: boolean;  // true when employee has 2 roster entries with a gap ≥ 2 hours
  splitSegments?: { startTime: string; endTime: string }[]; // both segments for display
}

/** Metadata stored alongside an EC (External Casual) roster entry */
export interface ExternalCasualMeta {
  zJobId: string;        // Z Staffing job UUID
  certLevel: string;     // 'CERT3' | 'DIPLOMA' | 'ECT' | 'NONE'
  costCents: number;     // total shift cost in cents (hourlyRateUsed × hours)
  status: string;        // 'Filled' | 'Completed' | 'GroupCompleted'
  workspaceId: string;   // Z Staffing workspace UUID
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

// ── Staffing Structure (Monday.com) ──────────────────────────────────────────

export type StaffQualification =
  | 'ECT' | 'WT ECT' | 'Diploma' | 'WT Diploma' | 'Certificate 3' | 'Trainee'
  | 'ISS' | 'Chef' | 'No Qualification' | string;

export interface StaffDocument {
  label: string;
  url: string;
}

export interface StaffCompliance {
  wwccNumber?: string;
  wwccExpiry?: string;        // ISO date
  firstAidCode?: string;
  firstAidExpiry?: string;
  cprCode?: string;
  cprExpiry?: string;
  anaphylaxisCode?: string;
  anaphylaxisExpiry?: string;
  childProtectionRenewal?: string;
}

export interface StaffMember {
  id?: string;          // Supabase UUID (present after migration)
  mondayId: string;
  name: string;
  qualification: StaffQualification;
  ratio50?: string;           // 50% ratio status
  position?: string;          // e.g. 'Room Leader', 'Educator'
  positionCategory?: string;  // 'Full Time' | 'Part Time' | 'Casual'
  campus?: string;
  startDate?: string;         // ISO date
  endDate?: string;           // freeform string
  dob?: string;
  daysPerWeek?: string;
  minHoursPerWeek?: string;
  probationaryDate?: string;
  email?: string;
  mobile?: string;
  seekUrl?: string;
  action?: string;            // e.g. 'Send Onboarding Kit'
  employmentStatus?: string;   // 'Active' | 'Inactive' | 'PPL' | 'Resigned' etc
  compliance: StaffCompliance;
  // File attachments on the main item
  docs: StaffDocument[];      // named docs (qual cert, transcripts, etc.)
  // Subitem documents (compliance certs)
  certDocs: StaffDocument[];  // WWC, First Aid, CPR, Anaphylaxis etc.
  // Derived
  isActive: boolean;          // has position + no real end date + not resigned
  isResigned: boolean;
  isVacancy: boolean;         // placeholder/vacancy item
}

export interface FloatStaff extends RosteredStaff {
  suggestedRoom?: string;
}

// ── Roster Builder ───────────────────────────────────────────────────────────

export interface RosterWeek {
  id: string;
  centre_id: string;
  week_start: string; // ISO date (Monday)
  status: 'draft' | 'published';
  created_by?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RosterShift {
  id: string;
  roster_week_id: string;
  centre_id: string;
  staff_id: string;
  staff_name: string;
  date: string; // ISO date
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  room_id?: string;
  room_name?: string;
  lunch_start?: string; // HH:MM
  lunch_duration: number;
  leave_type?: 'sick' | 'annual' | 'other';
  splitLeaveFrom?: string; // HH:MM — UI-only field for splitting a shift into worked + leave portions
  originalRoomId?: string; // UI-only: room before converting to leave
  originalRoomName?: string; // UI-only
  is_casual: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ── Kiosk Sign-In/Out ───────────────────────────────────────────────────────

export type KioskEventType = 'start_shift' | 'start_lunch' | 'end_lunch' | 'end_shift';

export interface KioskStaffPin {
  id: string;
  centre_id: string;
  staff_id: string;
  staff_name: string;
  mobile: string;
  pin: string;
  role?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface KioskTimeclockEvent {
  id: string;
  centre_id: string;
  staff_id: string;
  staff_name: string;
  event_type: KioskEventType;
  event_time: string; // ISO timestamp
  event_date: string; // ISO date
  roster_shift_id?: string;
  source: 'kiosk' | string;
  created_at: string;
}

export interface KioskSession {
  centre_id: string;
  staff_id: string;
  staff_name: string;
  role?: string;
  shift: RosterShift | null;
  events: KioskTimeclockEvent[];
}

// ── Timesheet Approvals ──────────────────────────────────────────────────────

export type TimesheetStatus = 'pending' | 'approved' | 'flagged';

export interface TimesheetApproval {
  id: string;
  centre_id: string;
  staff_id: string;
  staff_name: string;
  date: string; // ISO date
  roster_shift_id?: string | null;
  roster_start_time?: string | null;
  roster_end_time?: string | null;
  roster_lunch_start?: string | null;
  roster_lunch_duration?: number | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  actual_lunch_start?: string | null;
  actual_lunch_end?: string | null;
  approved_start_time?: string | null;
  approved_end_time?: string | null;
  approved_lunch_duration?: number | null;
  approved_hours: number;
  status: TimesheetStatus;
  flags: string[];
  approver_name?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoundingResult {
  approvedStart: string; // HH:MM
  approvedEnd: string; // HH:MM
  approvedLunchDuration: number; // minutes
  approvedHours: number;
  flags: string[];
}
