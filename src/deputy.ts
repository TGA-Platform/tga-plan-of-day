import type { RosteredStaff, AbsentStaff } from './types';

// Cache employee names to avoid repeated lookups
const employeeCache: Record<number, string> = {};

export async function fetchEmployeeName(employeeId: number): Promise<string> {
  if (employeeCache[employeeId]) return employeeCache[employeeId];
  
  // Batch through the employee proxy
  const names = await fetchEmployeeNames([employeeId]);
  return names[employeeId] || `Staff #${employeeId}`;
}

export async function fetchEmployeeNames(ids: number[]): Promise<Record<number, string>> {
  const uniqueIds = [...new Set(ids)].filter(id => !employeeCache[id]);
  
  if (uniqueIds.length > 0) {
    try {
      const res = await fetch('/api/deputy-employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: uniqueIds }),
      });
      if (res.ok) {
        const employees = await res.json();
        if (Array.isArray(employees)) {
          for (const emp of employees) {
            const name = emp.DisplayName || `${emp.FirstName || ''} ${emp.LastName || ''}`.trim() || `Staff #${emp.Id}`;
            employeeCache[emp.Id] = name;
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    }
  }
  
  const result: Record<number, string> = {};
  for (const id of ids) {
    result[id] = employeeCache[id] || `Staff #${id}`;
  }
  return result;
}

export async function fetchRosters(date: string, unitIds: number[], force = false): Promise<RosteredStaff[]> {
  try {
    const res = await fetch('/api/deputy-rosters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, unitIds, ...(force ? { force: true } : {}) }),
    });
    
    if (!res.ok) {
      console.error('Deputy proxy failed:', res.status, await res.text());
      throw new Error(`Deputy proxy ${res.status}`);
    }
    
    const rosters = await res.json();
    if (!Array.isArray(rosters) || rosters.length === 0) return [];
    
    // Get employee names
    const employeeIds = rosters.map((r: any) => r.Employee).filter(Boolean);
    const names = await fetchEmployeeNames(employeeIds);
    
    // Convert Deputy unix timestamp to HH:MM string in Sydney timezone
    const unixToHHMM = (t: number | string | null | undefined): string => {
      if (!t) return '';
      const num = typeof t === 'string' ? parseInt(t, 10) : t;
      if (isNaN(num) || num <= 100000) return String(t ?? '');
      const d = new Date(num * 1000);
      return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Sydney' }).slice(0, 5);
    };

    const mapped: RosteredStaff[] = rosters
      .filter((r: any) => {
        // Exclude open/unassigned shifts (Employee = 0) — these show as "Staff #0"
        if (!r.Employee || r.Employee === 0) return false;
        const uName = (r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '').toLowerCase();
        // Exclude non-ratio units: staff meetings, trainee study time
        if (uName.includes('staff meeting')) return false;
        if (uName.includes('study time')) return false;
        return true;
      })
      .map((r: any) => ({
        employeeId: r.Employee,
        // Prefer the display name already embedded in the roster response metadata
        employeeName: r._DPMetaData?.EmployeeInfo?.DisplayName || names[r.Employee] || `Staff #${r.Employee}`,
        startTime: unixToHHMM(r.StartTime),
        endTime:   unixToHHMM(r.EndTime),
        unitId: r.OperationalUnit,
        // Deputy uses OperationalUnitInfo (not OperationalUnitObject) in _DPMetaData
        unitName: r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '',
      }));

    // Deduplicate by employeeId: if an employee has multiple roster entries,
    // detect whether it's a split shift (gap ≥ 2 hours between segments).
    // Split shifts are kept as a single entry marked isSplitShift=true with
    // splitSegments storing both times. Non-split duplicates are merged as before.
    const SPLIT_GAP_MINS = 120; // 2 hours
    const toMinsLocal = (t: string): number => {
      if (!t) return 0;
      const parts = String(t).split(':').map(Number);
      return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    };

    // Group all entries by employeeId first
    const groupedByEmp = new Map<number, RosteredStaff[]>();
    for (const entry of mapped) {
      const group = groupedByEmp.get(entry.employeeId) ?? [];
      group.push(entry);
      groupedByEmp.set(entry.employeeId, group);
    }

    const result: RosteredStaff[] = [];
    for (const [, entries] of groupedByEmp) {
      if (entries.length === 1) {
        result.push(entries[0]);
        continue;
      }
      // Sort by startTime
      const sorted = [...entries].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
      // Check if any consecutive pair has a gap ≥ 2 hours
      let isSplit = false;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gapStart = toMinsLocal(String(sorted[i].endTime));
        const gapEnd   = toMinsLocal(String(sorted[i + 1].startTime));
        if (gapEnd - gapStart >= SPLIT_GAP_MINS) { isSplit = true; break; }
      }
      if (isSplit) {
        // Mark as split shift — use earliest start / latest end for overall times,
        // but store both segments so the UI can display them accurately.
        const first = sorted[0];
        const last  = sorted[sorted.length - 1];
        result.push({
          ...first,
          startTime:     first.startTime,
          endTime:       last.endTime,
          isSplitShift:  true,
          splitSegments: sorted.map(e => ({ startTime: e.startTime, endTime: e.endTime })),
        });
      } else {
        // Not a split shift — merge into one entry (earliest start, latest end)
        const merged = sorted.reduce((acc, e) => ({
          ...acc,
          startTime: String(acc.startTime) <= String(e.startTime) ? acc.startTime : e.startTime,
          endTime:   String(acc.endTime)   >= String(e.endTime)   ? acc.endTime   : e.endTime,
        }));
        result.push(merged);
      }
    }
    return result;
  } catch (err) {
    console.error('fetchRosters error:', err);
    return [];
  }
}

// Deputy leave operational unit IDs for Oatley
const LEAVE_UNIT_IDS = [134, 142]; // 134 = Annual Leave, 142 = Sick Leave

export async function fetchAbsentStaff(date: string, unitIds: number[]): Promise<AbsentStaff[]> {
  try {
    // Include leave units in query so we can detect absences
    const allUnitIds = [...new Set([...unitIds, ...LEAVE_UNIT_IDS])];
    const res = await fetch('/api/deputy-rosters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, unitIds: allUnitIds }),
    });
    
    if (!res.ok) return [];
    
    const rosters = await res.json();
    if (!Array.isArray(rosters)) return [];
    
    // Absent = rostered in a leave unit OR comment mentions leave/sick/absent
    // Note: Open===false just means the shift is ASSIGNED (not open) — do NOT use it to detect leave
    const leaveRosters = rosters.filter((r: any) => 
      LEAVE_UNIT_IDS.includes(r.OperationalUnit) ||
      r.Comment?.toLowerCase().includes('leave') ||
      r.Comment?.toLowerCase().includes('sick') ||
      r.Comment?.toLowerCase().includes('absent')
    );
    
    if (leaveRosters.length === 0) {
      return fetchAbsentFromTimesheets(date);
    }
    
    return leaveRosters.map((r: any) => ({
      employeeId: r.Employee,
      employeeName: r._DPMetaData?.EmployeeInfo?.DisplayName || `Staff #${r.Employee}`,
      reason: r.Comment || (LEAVE_UNIT_IDS.includes(r.OperationalUnit) ? 'On Leave' : 'Absent'),
    }));
  } catch (err) {
    console.error('fetchAbsentStaff error:', err);
    return [];
  }
}

async function fetchAbsentFromTimesheets(date: string): Promise<AbsentStaff[]> {
  try {
    const res = await fetch('/api/deputy-timesheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    });
    
    if (!res.ok) return [];
    
    const timesheets = await res.json();
    if (!Array.isArray(timesheets) || timesheets.length === 0) return [];
    
    const employeeIds = timesheets.map((t: any) => t.Employee).filter(Boolean);
    const names = await fetchEmployeeNames(employeeIds);
    
    return timesheets.map((t: any) => ({
      employeeId: t.Employee,
      employeeName: names[t.Employee] || `Staff #${t.Employee}`,
      reason: 'Leave',
    }));
  } catch {
    return [];
  }
}
