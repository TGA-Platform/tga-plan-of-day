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
        startTime: r.StartTime || '',
        endTime: r.EndTime || '',
        unitId: r.OperationalUnit,
        // Deputy uses OperationalUnitInfo (not OperationalUnitObject) in _DPMetaData
        unitName: r._DPMetaData?.OperationalUnitInfo?.OperationalUnitName || '',
      }));

    // Deduplicate by employeeId: if an employee has multiple roster entries
    // (e.g. split shift or multiple unit assignments), merge into one entry
    // using the earliest startTime and latest endTime so their full shift is covered.
    const byEmpId = new Map<number, RosteredStaff>();
    for (const entry of mapped) {
      const existing = byEmpId.get(entry.employeeId);
      if (!existing) {
        byEmpId.set(entry.employeeId, entry);
      } else {
        // Keep earliest start, latest end
        const existStart = String(existing.startTime);
        const entryStart = String(entry.startTime);
        const existEnd   = String(existing.endTime);
        const entryEnd   = String(entry.endTime);
        byEmpId.set(entry.employeeId, {
          ...existing,
          startTime: existStart <= entryStart ? existing.startTime : entry.startTime,
          endTime:   existEnd   >= entryEnd   ? existing.endTime   : entry.endTime,
        });
      }
    }
    return Array.from(byEmpId.values());
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
