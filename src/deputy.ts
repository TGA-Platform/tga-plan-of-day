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

export async function fetchRosters(date: string, unitIds: number[]): Promise<RosteredStaff[]> {
  try {
    const res = await fetch('/api/deputy-rosters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, unitIds }),
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
    
    return rosters.map((r: any) => ({
      employeeId: r.Employee,
      employeeName: names[r.Employee] || `Staff #${r.Employee}`,
      startTime: r.StartTime || '',
      endTime: r.EndTime || '',
      unitId: r.OperationalUnit,
      unitName: r._DPMetaData?.OperationalUnitObject?.OperationalUnitName || '',
    }));
  } catch (err) {
    console.error('fetchRosters error:', err);
    return [];
  }
}

export async function fetchAbsentStaff(date: string, unitIds: number[]): Promise<AbsentStaff[]> {
  try {
    const res = await fetch('/api/deputy-rosters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, unitIds }),
    });
    
    if (!res.ok) return [];
    
    const rosters = await res.json();
    if (!Array.isArray(rosters)) return [];
    
    // Absent staff: rosters with Open === false or leave-related comments
    const leaveRosters = rosters.filter((r: any) => 
      r.Open === false || 
      r.Comment?.toLowerCase().includes('leave') ||
      r.Comment?.toLowerCase().includes('sick') ||
      r.Comment?.toLowerCase().includes('absent')
    );
    
    if (leaveRosters.length === 0) {
      return fetchAbsentFromTimesheets(date);
    }
    
    const employeeIds = leaveRosters.map((r: any) => r.Employee).filter(Boolean);
    const names = await fetchEmployeeNames(employeeIds);
    
    return leaveRosters.map((r: any) => ({
      employeeId: r.Employee,
      employeeName: names[r.Employee] || `Staff #${r.Employee}`,
      reason: r.Comment || 'Absent',
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
