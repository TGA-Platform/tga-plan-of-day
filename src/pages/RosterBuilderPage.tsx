import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format, startOfWeek, addDays, parseISO, isSameDay,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, Plus, Printer,
  Trash2, Save, Upload, CheckCircle, AlertCircle, X,
  Smartphone,
} from 'lucide-react';
import Layout from '../components/Layout';
import RosterTabs from '../components/RosterTabs';
import { isStagingOrPreview } from '../lib/env';
import { CENTRES } from '../config';
import { getUser, getAllowedCentres } from '../auth';
import { fetchRosters } from '../deputy';
import type { Room, RosterShift, RosterWeek } from '../types';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';

const HEADERS = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Prefer': 'return=representation',
};

function weekStartStr(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHhmm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeInputOptions(): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 15) {
    out.push(minutesToHhmm(m));
  }
  return out;
}

const TIME_OPTIONS = timeInputOptions();

function getRoomColour(index: number): string {
  const palette = [
    '#dbeafe', '#dcfce7', '#fef9c3', '#ffedd5', '#f3e8ff',
    '#fce7f3', '#e0f2fe', '#d1fae5', '#fde68a', '#fecaca',
  ];
  return palette[index % palette.length];
}

function getRoomBorder(index: number): string {
  const palette = [
    '#2563eb', '#16a34a', '#ca8a04', '#c2410c', '#7c3aed',
    '#be185d', '#0284c7', '#059669', '#a16207', '#dc2626',
  ];
  return palette[index % palette.length];
}

interface StaffSource {
  id: string;
  name: string;
  qualification?: string;
  position?: string;
  positionCategory?: string;
  campus?: string;
  roleType: 'educator' | 'float' | 'director' | 'cook' | 'admin' | 'other';
  usualRoomId?: string;
  contractedHours?: number;
  mobile?: string;
  deputyEmployeeId?: string;
  wwccNumber?: string;
  wwccExpiry?: string;
}

interface CoverageSlot {
  time: string;
  minutes: number;
  required: number;
  assigned: number;
  status: 'green' | 'amber' | 'red';
}

interface CoverageResult {
  room: Room;
  slots: CoverageSlot[];
  worstStatus: 'green' | 'amber' | 'red';
}

const DEFAULT_ATTENDANCE: Record<string, number> = {};

// ── Supabase helpers ─────────────────────────────────────────────────────────

async function fetchStaffList(centreId: string): Promise<StaffSource[]> {
  // Use internal staff_members as the central source of truth.
  const res = await fetch(`/api/staff-members?centreId=${encodeURIComponent(centreId)}`);
  if (!res.ok) {
    console.error('fetchStaffList failed:', await res.text().catch(() => 'unknown'));
    return [];
  }
  const data = await res.json();
  const rows = data.staff || [];
  const list: StaffSource[] = (rows || []).map((r: any) => {
    const pos = String(r.position || '').toLowerCase();
    let roleType: StaffSource['roleType'] = 'educator';
    if (pos.includes('director') || pos.includes('ad') || pos.includes('educational leader')) roleType = 'director';
    else if (pos.includes('cook') || pos.includes('chef')) roleType = 'cook';
    else if (pos.includes('admin') || pos.includes('support')) roleType = 'admin';
    else if (pos.includes('float') || pos.includes('iss')) roleType = 'float';
    return {
      id: String(r.id),
      name: r.name || 'Unknown',
      qualification: r.qualification || '',
      position: r.position || '',
      positionCategory: r.position_category || '',
      campus: r.campus || '',
      roleType,
      usualRoomId: undefined,
      contractedHours: undefined,
      mobile: r.mobile || '',
      deputyEmployeeId: r.deputy_employee_id || '',
      wwccNumber: r.wwcc_number || '',
      wwccExpiry: r.wwcc_expiry || '',
    };
  });
  // Dedupe by name
  const seen = new Set<string>();
  return list.filter(s => {
    if (seen.has(s.name.toLowerCase())) return false;
    seen.add(s.name.toLowerCase());
    return true;
  });
}

async function getOrCreateWeek(centreId: string, weekStart: string, userEmail?: string): Promise<RosterWeek | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/roster_weeks?centre_id=eq.${centreId}&week_start=eq.${weekStart}&select=*&limit=1`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  );
  if (res.ok) {
    const rows = await res.json();
    if (rows?.length) return rows[0] as RosterWeek;
  }
  const create = await fetch(`${SUPABASE_URL}/rest/v1/roster_weeks`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ centre_id: centreId, week_start: weekStart, status: 'draft', created_by: userEmail }),
  });
  if (!create.ok) return null;
  const created = await create.json();
  return (Array.isArray(created) ? created[0] : created) as RosterWeek;
}

async function loadShifts(weekId: string): Promise<RosterShift[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/roster_shifts?roster_week_id=eq.${weekId}&select=*&order=date.asc,start_time.asc&limit=1000`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  );
  if (!res.ok) return [];
  return res.json();
}

async function saveShift(shift: Partial<RosterShift>): Promise<RosterShift | null> {
  const body = { ...shift };
  delete (body as any).created_at;
  delete (body as any).updated_at;
  if (shift.id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/roster_shifts?id=eq.${shift.id}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const updated = await loadShifts(shift.roster_week_id!);
    return updated.find(s => s.id === shift.id) || null;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/roster_shifts`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const created = await res.json().catch(() => null);
  return (Array.isArray(created) ? created[0] : created) as RosterShift;
}

async function deleteShift(shiftId: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/roster_shifts?id=eq.${shiftId}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  return res.ok;
}

async function publishWeek(weekId: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/roster_weeks?id=eq.${weekId}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ status: 'published', published_at: new Date().toISOString() }),
  });
  return res.ok;
}

async function deleteShiftsForDate(weekId: string, date: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/roster_shifts?roster_week_id=eq.${weekId}&date=eq.${date}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  return res.ok;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function RosterBuilderPage() {
  const navigate = useNavigate();
  const user = getUser();
  const allowedCentres = user ? getAllowedCentres(user) : CENTRES;

  const [centreId, setCentreId] = useState(user?.centreId || allowedCentres[0]?.id || CENTRES[0].id);
  const [weekDate, setWeekDate] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [view, setView] = useState<'week' | 'day'>('week');
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  const [staffList, setStaffList] = useState<StaffSource[]>([]);
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [weekRecord, setWeekRecord] = useState<RosterWeek | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalShift, setModalShift] = useState<Partial<RosterShift> | null>(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [weekViewMode, setWeekViewMode] = useState<'staff' | 'room'>('staff');

  const [printMode, setPrintMode] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [coverageOverride, setCoverageOverride] = useState(false);

  const [pinsModalOpen, setPinsModalOpen] = useState(false);
  const [pins, setPins] = useState<any[]>([]);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinSearch, setPinSearch] = useState('');

  const centre = useMemo(() => CENTRES.find(c => c.id === centreId) || CENTRES[0], [centreId]);
  const weekStart = weekStartStr(weekDate);
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(parseISO(weekStart), i)), [weekStart]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadData();
  }, [centreId, weekStart]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [staff, week] = await Promise.all([
        fetchStaffList(centreId),
        getOrCreateWeek(centreId, weekStart, user?.email),
      ]);
      setStaffList(staff);
      if (week) {
        setWeekRecord(week);
        const loaded = await loadShifts(week.id);
        setShifts(loaded);
      } else {
        setError('Could not load or create roster week. Check Supabase tables and RLS policies.');
      }
    } catch (err) {
      console.error('loadData error:', err);
      setError('Error loading roster data. Check console.');
    }
    setLoading(false);
  }

  async function handleSaveShift(shift: Partial<RosterShift>) {
    if (!weekRecord) return;
    setSaving(true);

    const startM = hhmmToMinutes(shift.start_time || '08:00');
    const endM = hhmmToMinutes(shift.end_time || '16:00');
    const leaveFromM = shift.splitLeaveFrom ? hhmmToMinutes(shift.splitLeaveFrom) : null;
    const isSplitLeave = !!(shift.leave_type && leaveFromM !== null && leaveFromM > startM && leaveFromM < endM);
    const isWholeLeave = !!(shift.leave_type && (leaveFromM === null || leaveFromM <= startM));
    const isNoLeavePeriod = !!(shift.leave_type && leaveFromM !== null && leaveFromM >= endM);

    if (isSplitLeave) {
      // Delete original if editing an existing shift
      if (shift.id) {
        await deleteShift(shift.id);
        setShifts(prev => prev.filter(s => s.id !== shift.id));
      }
      // Worked portion: original room, start to leave-from
      const workedRoomId = (shift as any).originalRoomId || shift.room_id;
      const workedRoomName = (shift as any).originalRoomName || shift.room_name;
      await saveShiftSingle({
        ...shift,
        id: undefined,
        end_time: shift.splitLeaveFrom,
        room_id: workedRoomId,
        room_name: workedRoomName,
        leave_type: undefined,
      });
      // Leave portion: leave room, leave-from to end
      await saveShiftSingle({
        ...shift,
        id: undefined,
        start_time: shift.splitLeaveFrom,
        room_id: 'leave',
        room_name: 'Leave',
      });
    } else if (isWholeLeave) {
      // Whole shift on leave: move to Leave lane (or keep it there)
      await saveShiftSingle({
        ...shift,
        room_id: 'leave',
        room_name: 'Leave',
        originalRoomId: (shift as any).originalRoomId || shift.room_id,
        originalRoomName: (shift as any).originalRoomName || shift.room_name,
      });
    } else if (isNoLeavePeriod) {
      // Leave-from at/past end means no actual leave; restore original room
      await saveShiftSingle({
        ...shift,
        room_id: (shift as any).originalRoomId || shift.room_id,
        room_name: (shift as any).originalRoomName || shift.room_name,
        leave_type: undefined,
        splitLeaveFrom: undefined,
      });
    } else {
      await saveShiftSingle(shift);
    }

    const loaded = await loadShifts(weekRecord.id);
    setShifts(loaded);
    setSaving(false);
    setModalOpen(false);
  }

  async function saveShiftSingle(shift: Partial<RosterShift>) {
    if (!weekRecord) return null;
    const saved = await saveShift({ ...shift, centre_id: centreId, roster_week_id: weekRecord.id });
    return saved;
  }

  async function handleDeleteShift(shiftId: string) {
    if (!confirm('Delete this shift?')) return;
    setSaving(true);
    const ok = await deleteShift(shiftId);
    if (ok) setShifts(prev => prev.filter(s => s.id !== shiftId));
    setSaving(false);
    setModalOpen(false);
  }

  async function handlePublish() {
    if (!weekRecord) return;
    const ok = await publishWeek(weekRecord.id);
    if (ok) {
      setWeekRecord({ ...weekRecord, status: 'published', published_at: new Date().toISOString() });
      setPublishModalOpen(false);
    }
  }

  async function handleImportFromDeputy() {
    let week = weekRecord;
    if (!week) {
      week = await getOrCreateWeek(centreId, weekStart, user?.email);
      if (week) setWeekRecord(week);
    }
    if (!week) {
      alert('Could not create roster week. Check Supabase tables/RLS policies.');
      return;
    }
    if (!confirm('Import Deputy rosters for this week? Existing draft shifts for each day will be replaced.')) return;
    setImporting(true);
    setError(null);
    const unitIds = [
      ...centre.rooms.map(r => r.deputyUnitId),
      ...(centre.floatUnitIds || []),
      ...(centre.issUnitIds || []),
      ...(centre.nonRatioUnitIds || []),
      ...(centre.leaveUnitIds || []),
    ];
    const floatIds = new Set(centre.floatUnitIds || []);
    const issIds = new Set(centre.issUnitIds || []);
    const nonRatioIds = new Set(centre.nonRatioUnitIds || []);
    const leaveIds = new Set(centre.leaveUnitIds || []);
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const day of weekDays) {
      const date = format(day, 'yyyy-MM-dd');
      try {
        const rosters = await fetchRosters(date, unitIds);
        if (rosters.length === 0) { skipped++; continue; }

        // Link Deputy employees to internal staff_members
        const uniqueEmployees = [...new Map(rosters.map(r => [r.employeeId, r.employeeName])).entries()];
        const linkRes = await fetch('/api/deputy-staff-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            centreId,
            employees: uniqueEmployees.map(([employeeId, employeeName]) => ({ employeeId, employeeName })),
          }),
        });
        let staffLinks: Record<string, string> = {};
        if (linkRes.ok) {
          const linkData = await linkRes.json();
          staffLinks = linkData.links || {};
          // Refresh staff list so new auto-created staff appear in the sidebar
          if (linkData.staff?.length) {
            const fresh = await fetchStaffList(centreId);
            setStaffList(fresh);
          }
        }

        const deleted = await deleteShiftsForDate(week.id, date);
        if (!deleted) {
          errors.push(`${date}: could not clear existing shifts (RLS/policy issue?)`);
          continue;
        }
        for (const r of rosters) {
          const room = centre.rooms.find(rm => rm.deputyUnitId === r.unitId);
          const uName = (r.unitName || '').toLowerCase();
          let roomName = room?.name;
          let roomId = room?.id;
          let leaveType: RosterShift['leave_type'] = undefined;
          if (!roomName) {
            if (floatIds.has(r.unitId)) { roomName = 'Float'; roomId = 'float'; }
            else if (issIds.has(r.unitId)) { roomName = 'ISS'; roomId = 'iss'; }
            else if (leaveIds.has(r.unitId)) {
              roomName = 'Leave';
              roomId = 'leave';
              if (uName.includes('sick')) leaveType = 'sick';
              else if (uName.includes('annual') || uName.includes('holiday')) leaveType = 'annual';
              else leaveType = 'other';
            }
            else if (nonRatioIds.has(r.unitId)) {
              if (uName.includes('director') || uName.includes('ed leader')) { roomName = 'Director'; roomId = 'director'; }
              else if (uName.includes('chef') || uName.includes('cook')) { roomName = 'Cook'; roomId = 'cook'; }
              else if (uName.includes('admin')) { roomName = 'Admin'; roomId = 'admin'; }
              else { roomName = r.unitName || 'Other'; roomId = 'other'; }
            }
            else { roomName = r.unitName || 'Other'; roomId = 'other'; }
          }
          // Link to internal staff profile by Deputy employee ID
          const linkedStaffId = staffLinks[String(r.employeeId)];
          const matchedStaff = staffList.find(s => s.id === linkedStaffId) ||
            staffList.find(s => s.deputyEmployeeId && String(s.deputyEmployeeId) === String(r.employeeId));
          const staffId = linkedStaffId || matchedStaff?.id || String(r.employeeId);
          const staffName = matchedStaff?.name || r.employeeName;
          const startM = hhmmToMinutes(r.startTime);
          const endM = hhmmToMinutes(r.endTime);
          const lunchM = Math.max(startM + 30, Math.min(endM - 60, startM + Math.floor((endM - startM) / 2)));
          const saved = await saveShift({
            roster_week_id: week.id,
            centre_id: centreId,
            staff_id: staffId,
            staff_name: staffName,
            date,
            start_time: r.startTime,
            end_time: r.endTime,
            room_id: roomId,
            room_name: roomName,
            lunch_start: minutesToHhmm(lunchM),
            lunch_duration: 30,
            leave_type: leaveType,
            is_casual: false,
          });
          if (saved) imported++; else errors.push(`${date}: failed to save shift for ${staffName}`);
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        errors.push(`${date}: ${msg}`);
      }
    }
    const loaded = await loadShifts(week.id);
    setShifts(loaded);
    setImporting(false);
    if (errors.length > 0) {
      setError(`Import errors:\n${errors.join('\n')}`);
      alert(`Imported ${imported} shifts. ${errors.length} errors:\n${errors.join('\n')}`);
    } else if (imported === 0) {
      alert('No Deputy rosters found for this week.');
    } else {
      alert(`Imported ${imported} shifts for ${format(weekDays[0], 'd MMM')} – ${format(weekDays[4], 'd MMM')}.`);
    }
  }

  function openAddModal(date: string, staff?: StaffSource) {
    setModalShift({
      date,
      staff_id: staff?.id,
      staff_name: staff?.name,
      start_time: '08:00',
      end_time: '16:00',
      room_id: '',
      lunch_start: '12:00',
      leave_type: undefined,
      splitLeaveFrom: undefined,
      originalRoomId: undefined,
      originalRoomName: undefined,
      lunch_duration: 30,
      is_casual: false,
      notes: '',
    });
    setModalOpen(true);
  }

  function normalizeTime(t?: string): string | undefined {
    if (!t) return undefined;
    return t.slice(0, 5);
  }

  function openEditModal(shift: RosterShift) {
    setModalShift({
      ...shift,
      start_time: normalizeTime(shift.start_time),
      end_time: normalizeTime(shift.end_time),
      lunch_start: normalizeTime(shift.lunch_start),
      splitLeaveFrom: shift.leave_type ? normalizeTime(shift.start_time) : undefined,
      originalRoomId: shift.room_id,
      originalRoomName: shift.room_name,
    });
    setModalOpen(true);
  }

  async function openPinsModal() {
    setPinsModalOpen(true);
    setPinLoading(true);
    try {
      const res = await fetch(`/api/kiosk-pins?centreId=${encodeURIComponent(centreId)}`);
      const data = await res.json();
      if (res.ok && data.ok) setPins(data.pins || []);
    } catch {
      setError('Failed to load kiosk PINs');
    }
    setPinLoading(false);
  }

  async function savePin(staffId: string, staffName: string, mobile: string, pin: string, role?: string) {
    setPinLoading(true);
    try {
      const res = await fetch('/api/kiosk-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centreId,
          staffId,
          staffName,
          mobile,
          pin,
          role,
          createdBy: user?.email,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save PIN');
      setPins(prev => {
        const idx = prev.findIndex(p => p.staff_id === staffId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = data.pin;
          return copy;
        }
        return [...prev, data.pin];
      });
    } catch (e: any) {
      setError(e.message || 'Failed to save PIN');
    }
    setPinLoading(false);
  }

  async function deletePin(id: string) {
    if (!confirm('Delete this PIN?')) return;
    setPinLoading(true);
    try {
      const res = await fetch(`/api/kiosk-pins?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) setPins(prev => prev.filter(p => p.id !== id));
    } catch {
      setError('Failed to delete PIN');
    }
    setPinLoading(false);
  }

  const coverageByRoom = useMemo((): CoverageResult[] => {
    const day = format(selectedDay, 'yyyy-MM-dd');
    const dayShifts = shifts.filter(s => s.date === day && s.room_id);
    return centre.rooms.map((room, _idx) => {
      const slots: CoverageSlot[] = [];
      let worstStatus: CoverageSlot['status'] = 'green';
      const attendance = DEFAULT_ATTENDANCE[room.id] || 0;
      const requiredBase = attendance > 0 ? Math.ceil(attendance / room.ratio) : 0;
      for (let m = 6 * 60; m < 18 * 60; m += 30) {
        const assigned = dayShifts.filter(s => {
          if (s.room_id !== room.id) return false;
          const sm = hhmmToMinutes(s.start_time);
          const em = hhmmToMinutes(s.end_time);
          if (m < sm || m >= em) return false;
          if (s.lunch_start) {
            const ls = hhmmToMinutes(s.lunch_start);
            const le = ls + (s.lunch_duration || 30);
            if (m >= ls && m < le) return false;
          }
          return true;
        }).length;
        const required = Math.max(requiredBase, 1);
        let status: CoverageSlot['status'] = 'green';
        if (assigned < required) status = 'red';
        else if (assigned === required) status = 'amber';
        if (required === 0) status = 'green';
        if (status === 'red' || (status === 'amber' && worstStatus === 'green')) worstStatus = status;
        slots.push({ time: minutesToHhmm(m), minutes: m, required, assigned, status });
      }
      return { room, slots, worstStatus };
    });
  }, [shifts, selectedDay, centre]);

  const hasCoverageRed = coverageByRoom.some(r => r.worstStatus === 'red');

  function handleDropOnCell(e: React.DragEvent, date: string, staffId?: string) {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    const parsed = JSON.parse(data);
    const sid = staffId || parsed.staffId;
    const sname = parsed.staffName || staffList.find(s => s.id === sid)?.name || 'Unknown';
    openAddModal(date, { id: sid, name: sname } as StaffSource);
  }

  function handleDropOnRoomLane(e: React.DragEvent, roomId: string, roomName: string) {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    const parsed = JSON.parse(data);
    const shiftId = parsed.shiftId;
    if (shiftId) {
      const shift = shifts.find(s => s.id === shiftId);
      if (shift) handleSaveShift({ ...shift, room_id: roomId, room_name: roomName });
    } else {
      const sid = parsed.staffId;
      const sname = parsed.staffName || staffList.find(s => s.id === sid)?.name || 'Unknown';
      openAddModal(format(selectedDay, 'yyyy-MM-dd'), { id: sid, name: sname } as StaffSource);
    }
  }

  function normalizeName(name: string) {
    return String(name || '')
      .toLowerCase()
      .replace(/\s*[\[(<].*?[\])>]\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const staffForDisplay = useMemo(() => {
    const fromShifts = shifts.map(s => ({ id: s.staff_id, name: s.staff_name, roleType: 'educator' as const }));
    const map = new Map<string, StaffSource>();
    const normalizedNames = new Map<string, string>(); // normalized -> canonical name
    for (const s of staffList) {
      map.set(s.id, s);
      const norm = normalizeName(s.name);
      if (!normalizedNames.has(norm)) normalizedNames.set(norm, s.name);
    }
    for (const s of fromShifts) {
      const norm = normalizeName(s.name);
      const canonical = normalizedNames.get(norm);
      // Skip if this staff is already in the list by ID or by normalized name.
      // Prefer the staffing-section name when merging.
      if (!map.has(s.id) && !canonical) {
        map.set(s.id, s);
        normalizedNames.set(norm, s.name);
      }
    }
    return Array.from(map.values());
  }, [staffList, shifts]);

  const filteredStaff = useMemo(() => {
    return staffForDisplay.filter(s => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (roleFilter !== 'all' && s.roleType !== roleFilter) return false;
      return true;
    });
  }, [staffForDisplay, search, roleFilter]);

  function WeekView() {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: '#596570' }}>View by:</span>
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: '#D0E8B8' }}>
            <button
              onClick={() => setWeekViewMode('staff')}
              className="px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: weekViewMode === 'staff' ? '#2d5c18' : 'white', color: weekViewMode === 'staff' ? 'white' : '#596570' }}
            >
              Staff
            </button>
            <button
              onClick={() => setWeekViewMode('room')}
              className="px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: weekViewMode === 'room' ? '#2d5c18' : 'white', color: weekViewMode === 'room' ? 'white' : '#596570' }}
            >
              Room
            </button>
          </div>
        </div>

        {weekViewMode === 'staff' ? (
          <div className="grid" style={{ gridTemplateColumns: '180px repeat(5, 1fr)', gap: '8px' }}>
            <div className="text-xs font-semibold" style={{ color: '#596570' }}>Staff / Day</div>
            {weekDays.map(d => (
              <div key={format(d, 'yyyy-MM-dd')} className="text-xs font-semibold text-center py-2 rounded-lg" style={{ color: '#2d5c18', backgroundColor: '#F5FAF3' }}>
                {format(d, 'EEE d MMM')}
              </div>
            ))}
            {filteredStaff.map(staff => (
              <React.Fragment key={staff.id}>
                <div className="text-sm font-medium py-2" style={{ color: '#050505' }}>{staff.name}</div>
                {weekDays.map(d => {
                  const date = format(d, 'yyyy-MM-dd');
                  const dayShifts = shifts.filter(s => s.date === date && s.staff_id === staff.id);
                  return (
                    <div
                      key={date}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDropOnCell(e, date, staff.id)}
                      onClick={() => openAddModal(date, staff)}
                      className="min-h-[60px] rounded-lg border border-dashed p-1.5 cursor-pointer hover:bg-white"
                      style={{ borderColor: '#D0E8B8', backgroundColor: '#F5FAF3' }}
                    >
                      {dayShifts.length === 0 && <Plus size={14} className="mx-auto mt-3" style={{ color: '#D0E8B8' }} />}
                      {dayShifts.map(s => {
                        const roomIdx = centre.rooms.findIndex(r => r.id === s.room_id);
                        return (
                          <div
                            key={s.id}
                            draggable
                            onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('application/json', JSON.stringify({ shiftId: s.id })); }}
                            onClick={e => { e.stopPropagation(); openEditModal(s); }}
                            className="text-xs rounded px-1.5 py-1 mb-1 border"
                            style={{
                              backgroundColor: s.room_id ? getRoomColour(roomIdx >= 0 ? roomIdx : centre.rooms.length) : '#f3f4f6',
                              borderColor: s.room_id ? getRoomBorder(roomIdx >= 0 ? roomIdx : centre.rooms.length) : '#d1d5db',
                              color: '#050505',
                            }}
                          >
                            <div className="font-medium">{s.start_time}–{s.end_time}</div>
                            <div className="truncate">{s.room_name || 'Unassigned'}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: '180px repeat(5, 1fr)', gap: '8px' }}>
            <div className="text-xs font-semibold" style={{ color: '#596570' }}>Room / Day</div>
            {weekDays.map(d => (
              <div key={format(d, 'yyyy-MM-dd')} className="text-xs font-semibold text-center py-2 rounded-lg" style={{ color: '#2d5c18', backgroundColor: '#F5FAF3' }}>
                {format(d, 'EEE d MMM')}
              </div>
            ))}
            {[
              ...centre.rooms.map((r, i) => ({ id: r.id, name: r.name, idx: i })),
              { id: 'float', name: 'Float', idx: centre.rooms.length },
              { id: 'iss', name: 'ISS', idx: centre.rooms.length + 1 },
              { id: 'director', name: 'Director', idx: centre.rooms.length + 2 },
              { id: 'cook', name: 'Cook', idx: centre.rooms.length + 3 },
              { id: 'admin', name: 'Admin', idx: centre.rooms.length + 4 },
              { id: 'leave', name: 'Leave', idx: centre.rooms.length + 5 },
              { id: 'other', name: 'Other / Unassigned', idx: centre.rooms.length + 6 },
            ].map(area => (
              <React.Fragment key={area.id}>
                <div className="text-sm font-medium py-2" style={{ color: '#050505' }}>{area.name}</div>
                {weekDays.map(d => {
                  const date = format(d, 'yyyy-MM-dd');
                  const dayShifts = shifts.filter(s => s.date === date && s.room_id === area.id);
                  return (
                    <div
                      key={date}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDropOnRoomLane(e, area.id, area.name)}
                      onClick={() => openAddModal(date)}
                      className="min-h-[60px] rounded-lg border border-dashed p-1.5 cursor-pointer hover:bg-white"
                      style={{ borderColor: '#D0E8B8', backgroundColor: '#F5FAF3' }}
                    >
                      {dayShifts.length === 0 && <Plus size={14} className="mx-auto mt-3" style={{ color: '#D0E8B8' }} />}
                      {dayShifts.map(s => (
                        <div
                          key={s.id}
                          draggable
                          onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('application/json', JSON.stringify({ shiftId: s.id })); }}
                          onClick={e => { e.stopPropagation(); openEditModal(s); }}
                          className="text-xs rounded px-1.5 py-1 mb-1 border"
                          style={{
                            backgroundColor: getRoomColour(area.idx),
                            borderColor: getRoomBorder(area.idx),
                            color: '#050505',
                          }}
                        >
                          <div className="font-medium">{s.start_time}–{s.end_time}</div>
                          <div className="truncate">{s.staff_name}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    );
  }

  function DayView() {
    const dayStr = format(selectedDay, 'yyyy-MM-dd');
    const dayShifts = shifts.filter(s => s.date === dayStr);
    const times: string[] = [];
    for (let m = 6 * 60; m <= 18 * 60; m += 30) times.push(minutesToHhmm(m));

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {weekDays.map(d => (
            <button
              key={format(d, 'yyyy-MM-dd')}
              onClick={() => setSelectedDay(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${isSameDay(d, selectedDay) ? 'text-white' : ''}`}
              style={{
                borderColor: '#D0E8B8',
                backgroundColor: isSameDay(d, selectedDay) ? '#2d5c18' : 'white',
                color: isSameDay(d, selectedDay) ? 'white' : '#596570',
              }}
            >
              {format(d, 'EEE d')}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            {/* Time header */}
            <div className="grid" style={{ gridTemplateColumns: '160px repeat(25, 1fr)' }}>
              <div></div>
              {times.map(t => (
                <div key={t} className="text-[10px] text-center py-1" style={{ color: '#596570' }}>{t}</div>
              ))}
            </div>

            {/* Staff rows */}
            {filteredStaff.map(staff => {
              const staffShifts = dayShifts.filter(s => s.staff_id === staff.id);
              return (
                <div key={staff.id} className="grid items-center border-b" style={{ gridTemplateColumns: '160px repeat(25, 1fr)', borderColor: '#E2F1DA' }}>
                  <div className="text-sm font-medium py-2 pr-2 truncate" style={{ color: '#050505' }}>{staff.name}</div>
                  {times.map((t, idx) => {
                    const m = 6 * 60 + idx * 30;
                    const shiftHere = staffShifts.find(s => {
                      const sm = hhmmToMinutes(s.start_time);
                      const em = hhmmToMinutes(s.end_time);
                      return m >= sm && m < em;
                    });
                    return (
                      <div
                        key={t}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => handleDropOnCell(e, dayStr, staff.id)}
                        onClick={() => shiftHere ? openEditModal(shiftHere) : openAddModal(dayStr, staff)}
                        className={`h-10 border-r ${shiftHere ? '' : 'hover:bg-white cursor-pointer'}`}
                        style={{ borderColor: '#E2F1DA', backgroundColor: shiftHere ? undefined : '#F5FAF3' }}
                      >
                        {shiftHere && m === hhmmToMinutes(shiftHere.start_time) && (
                          <div
                            draggable
                            onDragStart={e => { e.dataTransfer.setData('application/json', JSON.stringify({ shiftId: shiftHere.id })); }}
                            className="h-full text-xs rounded border px-1 flex items-center overflow-hidden"
                            style={{
                              backgroundColor: shiftHere.room_id ? getRoomColour(centre.rooms.findIndex(r => r.id === shiftHere.room_id)) : '#f3f4f6',
                              borderColor: shiftHere.room_id ? getRoomBorder(centre.rooms.findIndex(r => r.id === shiftHere.room_id)) : '#d1d5db',
                              width: `${((hhmmToMinutes(shiftHere.end_time) - hhmmToMinutes(shiftHere.start_time)) / 30) * 100}%`,
                            }}
                          >
                            <span className="truncate">{shiftHere.start_time}–{shiftHere.end_time}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Room lanes */}
            <div className="mt-6 space-y-3">
              <div className="font-semibold text-sm" style={{ color: '#2d5c18' }}>Room assignments</div>
              {[
                ...centre.rooms.map((r, i) => ({ id: r.id, name: r.name, idx: i, ratio: r.ratio })),
                { id: 'float', name: 'Float', idx: centre.rooms.length },
                { id: 'iss', name: 'ISS', idx: centre.rooms.length + 1 },
                { id: 'director', name: 'Director', idx: centre.rooms.length + 2 },
                { id: 'cook', name: 'Cook', idx: centre.rooms.length + 3 },
                { id: 'admin', name: 'Admin', idx: centre.rooms.length + 4 },
                { id: 'leave', name: 'Leave', idx: centre.rooms.length + 5 },
                { id: 'other', name: 'Other / Unassigned', idx: centre.rooms.length + 6 },
              ].map(area => {
                const cov = 'ratio' in area ? coverageByRoom.find(c => c.room.id === area.id) : null;
                return (
                  <div key={area.id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-sm font-medium" style={{ color: '#050505' }}>{area.name}</div>
                      <div className="flex items-center gap-1">
                        {cov?.worstStatus === 'red' && <span className="w-2 h-2 rounded-full bg-red-500"></span>}
                        {cov?.worstStatus === 'amber' && <span className="w-2 h-2 rounded-full bg-yellow-500"></span>}
                        {cov?.worstStatus === 'green' && <span className="w-2 h-2 rounded-full bg-green-500"></span>}
                        {'ratio' in area && <span className="text-xs" style={{ color: '#596570' }}>ratio {area.ratio}:1</span>}
                      </div>
                    </div>
                    <div
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => handleDropOnRoomLane(e, area.id, area.name)}
                      className="h-10 rounded-lg border border-dashed"
                      style={{ borderColor: getRoomBorder(area.idx), backgroundColor: getRoomColour(area.idx) }}
                    >
                      <div className="flex h-full">
                        {cov ? cov.slots.map(slot => (
                          <div
                            key={slot.time}
                            className="flex-1 h-full border-r"
                            style={{
                              borderColor: 'rgba(0,0,0,0.05)',
                              backgroundColor: slot.status === 'red' ? '#fee2e2' : slot.status === 'amber' ? '#fef9c3' : '#dcfce7',
                            }}
                            title={`${slot.time}: ${slot.assigned}/${slot.required}`}
                          />
                        )) : Array.from({ length: 24 }).map((_, i) => (
                          <div key={i} className="flex-1 h-full border-r" style={{ borderColor: 'rgba(0,0,0,0.05)' }} />
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-between text-[10px] mt-0.5" style={{ color: '#596570' }}>
                      <span>06:00</span>
                      <span>18:00</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function ShiftModal() {
    const [draft, setDraft] = useState<Partial<RosterShift>>(modalShift || {});
    const staffOptions = staffForDisplay.map(s => ({ id: s.id, name: s.name }));

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl p-5 w-full max-w-md space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg" style={{ color: '#2d5c18' }}>{draft.id ? 'Edit Shift' : 'Add Shift'}</h3>
            <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold" style={{ color: '#596570' }}>Staff</label>
              <select
                value={draft.staff_id || ''}
                onChange={e => {
                  const sid = e.target.value;
                  const sname = staffList.find(s => s.id === sid)?.name || '';
                  setDraft({ ...draft, staff_id: sid, staff_name: sname });
                }}
                className="w-full px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
              >
                <option value="">Select staff</option>
                {staffOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold" style={{ color: '#596570' }}>Date</label>
              <input
                type="date"
                value={draft.date || ''}
                onChange={e => setDraft({ ...draft, date: e.target.value })}
                className="w-full px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold" style={{ color: '#596570' }}>Start</label>
                <select
                  value={draft.start_time || '08:00'}
                  onChange={e => setDraft({ ...draft, start_time: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm"
                  style={{ borderColor: '#D0E8B8' }}
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: '#596570' }}>End</label>
                <select
                  value={draft.end_time || '16:00'}
                  onChange={e => setDraft({ ...draft, end_time: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm"
                  style={{ borderColor: '#D0E8B8' }}
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold" style={{ color: '#596570' }}>Room</label>
              <select
                value={draft.room_id || ''}
                onChange={e => {
                  const rid = e.target.value;
                  const fixedNames: Record<string, string> = {
                    float: 'Float', iss: 'ISS', director: 'Director', admin: 'Admin', cook: 'Cook', leave: 'Leave', other: 'Other',
                  };
                  const rname = centre.rooms.find(r => r.id === rid)?.name || fixedNames[rid] || (rid ? 'Other' : '');
                  setDraft({ ...draft, room_id: rid || undefined, room_name: rname || undefined });
                }}
                className="w-full px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
              >
                <option value="">Unassigned / Float</option>
                {centre.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                <option value="float">Float</option>
                <option value="iss">ISS</option>
                <option value="director">Director</option>
                <option value="admin">Admin</option>
                <option value="cook">Cook</option>
                <option value="leave">Leave</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold" style={{ color: '#596570' }}>Leave type</label>
              <select
                value={draft.leave_type || ''}
                onChange={e => {
                  const lt = (e.target.value as RosterShift['leave_type']) || undefined;
                  setDraft({
                    ...draft,
                    leave_type: lt,
                    splitLeaveFrom: lt ? (draft.start_time || '08:00') : undefined,
                  });
                }}
                className="w-full px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
              >
                <option value="">Not leave</option>
                <option value="sick">Sick leave</option>
                <option value="annual">Annual leave</option>
                <option value="other">Other leave</option>
              </select>
            </div>

            {draft.leave_type && (
              <div>
                <label className="text-xs font-semibold" style={{ color: '#596570' }}>Leave from</label>
                <select
                  value={draft.splitLeaveFrom || draft.start_time || '08:00'}
                  onChange={e => setDraft({ ...draft, splitLeaveFrom: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm"
                  style={{ borderColor: '#D0E8B8' }}
                >
                  {TIME_OPTIONS.filter(t => t >= (draft.start_time || '08:00') && t <= (draft.end_time || '16:00')).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <div className="text-[10px] mt-0.5" style={{ color: '#596570' }}>
                  Default = full shift on leave. Change to split into worked + leave portions.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold" style={{ color: '#596570' }}>Lunch start</label>
                <select
                  value={draft.lunch_start || ''}
                  onChange={e => setDraft({ ...draft, lunch_start: e.target.value || undefined })}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm"
                  style={{ borderColor: '#D0E8B8' }}
                >
                  <option value="">No break</option>
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: '#596570' }}>Lunch duration</label>
                <select
                  value={draft.lunch_duration || 30}
                  onChange={e => setDraft({ ...draft, lunch_duration: parseInt(e.target.value) })}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm"
                  style={{ borderColor: '#D0E8B8' }}
                >
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>60 min</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold" style={{ color: '#596570' }}>Notes</label>
              <input
                type="text"
                value={draft.notes || ''}
                onChange={e => setDraft({ ...draft, notes: e.target.value })}
                className="w-full px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: '#D0E8B8' }}
              />
            </div>

            <label className="flex items-center gap-2 text-sm" style={{ color: '#050505' }}>
              <input
                type="checkbox"
                checked={draft.is_casual || false}
                onChange={e => setDraft({ ...draft, is_casual: e.target.checked })}
              />
              Casual fill
            </label>
          </div>

          <div className="flex items-center justify-between pt-2">
            {draft.id ? (
              <button
                onClick={() => handleDeleteShift(draft.id!)}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5"
                style={{ backgroundColor: '#dc2626' }}
              >
                <Trash2 size={16} /> Delete
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold border"
                style={{ borderColor: '#D0E8B8', color: '#596570' }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveShift(draft)}
                disabled={saving || !draft.staff_id || !draft.date || !draft.start_time || !draft.end_time}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5"
                style={{ backgroundColor: '#2d5c18' }}
              >
                <Save size={16} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function PublishModal() {
    const redRooms = coverageByRoom.filter(r => r.worstStatus === 'red');
    const canPublish = !hasCoverageRed || coverageOverride;
    const shiftCount = shifts.length;
    const staffCount = new Set(shifts.map(s => s.staff_id)).size;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl p-5 w-full max-w-md space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg" style={{ color: '#2d5c18' }}>Publish Roster</h3>
            <button onClick={() => setPublishModalOpen(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
          </div>

          <div className="text-sm space-y-2" style={{ color: '#050505' }}>
            <p>{centre.name} — week starting {format(parseISO(weekStart), 'd MMM yyyy')}</p>
            <p>{shiftCount} shifts across {staffCount} staff</p>
            {hasCoverageRed && (
              <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                <div className="flex items-center gap-2 font-semibold"><AlertCircle size={16} /> Coverage gaps</div>
                <ul className="mt-1 ml-5 list-disc">
                  {redRooms.map(r => <li key={r.room.id}>{r.room.name}</li>)}
                </ul>
              </div>
            )}
            {user?.role !== 'director' && (
              <label className="flex items-center gap-2 text-sm" style={{ color: '#050505' }}>
                <input type="checkbox" checked={coverageOverride} onChange={e => setCoverageOverride(e.target.checked)} />
                HQ override — publish despite coverage gaps
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setPublishModalOpen(false)}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold border"
              style={{ borderColor: '#D0E8B8', color: '#596570' }}
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={!canPublish}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5"
              style={{ backgroundColor: '#2d5c18' }}
            >
              <CheckCircle size={16} /> Publish
            </button>
          </div>
        </div>
      </div>
    );
  }

  function PinModal() {
    const [draft, setDraft] = useState<Record<string, { mobile: string; pin: string; role?: string }>>({});
    const filteredPins = pins.filter(p => !pinSearch || p.staff_name?.toLowerCase().includes(pinSearch.toLowerCase()));
    const staffWithoutPin = filteredStaff.filter(s => !pins.some(p => p.staff_id === s.id));

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl p-5 w-full max-w-2xl space-y-4 shadow-xl" style={{ maxHeight: '90vh', overflow: 'auto' }}>
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg" style={{ color: '#2d5c18' }}>Kiosk PINs — {centre.name}</h3>
            <button onClick={() => setPinsModalOpen(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
          </div>

          <p className="text-sm" style={{ color: '#596570' }}>
            Staff use their mobile number and 4-digit PIN to clock in/out at the kiosk.
          </p>

          <input
            type="text"
            placeholder="Search staff..."
            value={pinSearch}
            onChange={e => setPinSearch(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg border text-sm"
            style={{ borderColor: '#D0E8B8' }}
          />

          {pinLoading && <p className="text-sm" style={{ color: '#596570' }}>Loading…</p>}

          <div className="space-y-2">
            <h4 className="font-semibold text-sm" style={{ color: '#2d5c18' }}>Existing PINs</h4>
            {filteredPins.length === 0 && <p className="text-sm" style={{ color: '#596570' }}>No PINs set.</p>}
            {filteredPins.map(p => (
              <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: '#E2F1DA' }}>
                <div className="flex-1">
                  <div className="font-medium text-sm" style={{ color: '#050505' }}>{p.staff_name}</div>
                  <div className="text-xs" style={{ color: '#596570' }}>{p.mobile} • PIN {p.pin}{p.role ? ` • ${p.role}` : ''}</div>
                </div>
                <button
                  onClick={() => deletePin(p.id)}
                  className="p-1.5 rounded-lg text-white"
                  style={{ backgroundColor: '#dc2626' }}
                  title="Delete PIN"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-sm" style={{ color: '#2d5c18' }}>Set PIN for staff</h4>
            {staffWithoutPin.length === 0 && <p className="text-sm" style={{ color: '#596570' }}>All staff have PINs.</p>}
            {staffWithoutPin.slice(0, 50).map(s => {
              const d = draft[s.id] || { mobile: s.mobile || '', pin: '', role: s.position || s.roleType || '' };
              return (
                <div key={s.id} className="flex items-end gap-2 p-3 rounded-lg border" style={{ borderColor: '#E2F1DA' }}>
                  <div className="flex-1">
                    <div className="font-medium text-sm" style={{ color: '#050505' }}>{s.name}</div>
                    <div className="text-xs" style={{ color: '#596570' }}>{s.position || s.roleType}</div>
                  </div>
                  <input
                    type="tel"
                    placeholder="Mobile"
                    value={d.mobile}
                    onChange={e => setDraft(prev => ({ ...prev, [s.id]: { ...d, mobile: e.target.value } }))}
                    className="w-32 px-2 py-1.5 rounded-lg border text-sm"
                    style={{ borderColor: '#D0E8B8' }}
                  />
                  <input
                    type="text"
                    placeholder="4-digit PIN"
                    maxLength={4}
                    value={d.pin}
                    onChange={e => setDraft(prev => ({ ...prev, [s.id]: { ...d, pin: e.target.value.replace(/\D/g, '').slice(0, 4) } }))}
                    className="w-28 px-2 py-1.5 rounded-lg border text-sm"
                    style={{ borderColor: '#D0E8B8' }}
                  />
                  <button
                    onClick={() => savePin(s.id, s.name, d.mobile, d.pin, d.role)}
                    disabled={!d.mobile || d.pin.length !== 4}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: '#2d5c18' }}
                  >
                    Save
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (printMode) {
    return (
      <div className="p-8 bg-white text-black min-h-screen">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">{centre.name} — Roster Week Starting {format(parseISO(weekStart), 'd MMM yyyy')}</h1>
          <button onClick={() => setPrintMode(false)} className="text-sm underline no-print">Close print view</button>
        </div>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="border p-2 text-left">Staff</th>
              {weekDays.map(d => (
                <th key={format(d, 'yyyy-MM-dd')} className="border p-2 text-left">{format(d, 'EEE d MMM')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredStaff.map(staff => (
              <tr key={staff.id}>
                <td className="border p-2 font-medium">{staff.name}</td>
                {weekDays.map(d => {
                  const date = format(d, 'yyyy-MM-dd');
                  const dayShifts = shifts.filter(s => s.date === date && s.staff_id === staff.id);
                  return (
                    <td key={date} className="border p-2 align-top">
                      {dayShifts.map(s => (
                        <div key={s.id} className="mb-1">
                          {s.start_time}–{s.end_time} {s.room_name || 'Unassigned'}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-8 text-xs text-gray-500">Printed from Plan of the Day Roster Builder</div>
      </div>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        {isStagingOrPreview() && <RosterTabs centreId={centreId} />}
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold" style={{ color: '#2d5c18' }}>Roster Builder</h1>
            <select
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}
              value={centreId}
              onChange={e => setCentreId(e.target.value)}
            >
              {allowedCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWeekDate(addDays(weekDate, -7))}
                className="p-1.5 rounded-lg border hover:bg-white"
                style={{ borderColor: '#D0E8B8' }}
              >
                <ChevronLeft size={18} />
              </button>
              <div className="px-3 py-1.5 text-sm font-medium rounded-lg border" style={{ borderColor: '#D0E8B8', backgroundColor: 'white' }}>
                {format(parseISO(weekStart), 'd MMM')} – {format(addDays(parseISO(weekStart), 4), 'd MMM yyyy')}
              </div>
              <button
                onClick={() => setWeekDate(addDays(weekDate, 7))}
                className="p-1.5 rounded-lg border hover:bg-white"
                style={{ borderColor: '#D0E8B8' }}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: '#D0E8B8' }}>
              <button
                onClick={() => setView('week')}
                className={`px-3 py-1.5 text-sm font-medium ${view === 'week' ? 'text-white' : ''}`}
                style={{ backgroundColor: view === 'week' ? '#2d5c18' : 'white', color: view === 'week' ? 'white' : '#596570' }}
              >
                Week
              </button>
              <button
                onClick={() => setView('day')}
                className={`px-3 py-1.5 text-sm font-medium ${view === 'day' ? 'text-white' : ''}`}
                style={{ backgroundColor: view === 'day' ? '#2d5c18' : 'white', color: view === 'day' ? 'white' : '#596570' }}
              >
                Day
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {weekRecord?.status === 'published' && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>
                Published
              </span>
            )}
            {hasCoverageRed && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                Coverage gaps today
              </span>
            )}
            <button
              onClick={handleImportFromDeputy}
              disabled={importing}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold border flex items-center gap-1.5 disabled:opacity-50"
              style={{ borderColor: '#D0E8B8', color: '#2d5c18', backgroundColor: 'white' }}
            >
              <Upload size={16} /> {importing ? 'Importing…' : 'Import from Deputy'}
            </button>
            <button
              onClick={() => setPrintMode(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold border flex items-center gap-1.5"
              style={{ borderColor: '#D0E8B8', color: '#2d5c18', backgroundColor: 'white' }}
            >
              <Printer size={16} /> Print
            </button>
            <button
              onClick={() => openPinsModal()}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold border flex items-center gap-1.5"
              style={{ borderColor: '#D0E8B8', color: '#2d5c18', backgroundColor: 'white' }}
            >
              <Smartphone size={16} /> Kiosk PINs
            </button>
            <button
              onClick={() => setPublishModalOpen(true)}
              disabled={!weekRecord || weekRecord.status === 'published'}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5"
              style={{ backgroundColor: '#2d5c18' }}
            >
              <CheckCircle size={16} /> Publish
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
            {error}
          </div>
        )}

        {/* Main grid */}
        <div className="flex gap-4" style={{ minHeight: '60vh' }}>
          {/* Staff sidebar */}
          <aside className="w-64 flex-shrink-0 rounded-2xl border p-4 space-y-3" style={{ borderColor: '#E2F1DA', backgroundColor: 'white' }}>
            <div className="font-semibold text-sm" style={{ color: '#2d5c18' }}>Staff</div>
            <input
              type="text"
              placeholder="Search staff..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: '#D0E8B8' }}
            />
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: '#D0E8B8' }}
            >
              <option value="all">All roles</option>
              <option value="educator">Educator</option>
              <option value="float">Float</option>
              <option value="director">Director</option>
              <option value="cook">Cook</option>
              <option value="admin">Admin</option>
            </select>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {filteredStaff.map(staff => (
                <div
                  key={staff.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('application/json', JSON.stringify({ staffId: staff.id, staffName: staff.name })); }}
                  className="p-2 rounded-lg border cursor-grab hover:shadow-sm"
                  style={{ borderColor: '#E2F1DA', backgroundColor: '#F5FAF3' }}
                >
                  <div className="text-sm font-medium" style={{ color: '#050505' }}>{staff.name}</div>
                  <div className="text-xs" style={{ color: '#596570' }}>{staff.position || staff.roleType}</div>
                  {staff.qualification && (
                    <div className="text-xs mt-1 inline-block px-1.5 py-0.5 rounded" style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                      {staff.qualification}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </aside>

          {/* Views */}
          <main className="flex-1 rounded-2xl border p-4" style={{ borderColor: '#E2F1DA', backgroundColor: 'white' }}>
            {loading ? (
              <div className="text-sm" style={{ color: '#596570' }}>Loading…</div>
            ) : view === 'week' ? (
              <WeekView />
            ) : (
              <DayView />
            )}
          </main>
        </div>
      </div>

      {modalOpen && <ShiftModal />}
      {publishModalOpen && <PublishModal />}
      {pinsModalOpen && <PinModal />}
    </Layout>
  );
}
