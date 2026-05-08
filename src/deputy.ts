import { DEPUTY_BASE, DEPUTY_TOKEN } from './config';
import type { RosteredStaff, AbsentStaff } from './types';

const headers = {
  'Authorization': `Bearer ${DEPUTY_TOKEN}`,
  'Content-Type': 'application/json',
};

// Cache employee names to avoid repeated lookups
const employeeCache: Record<number, string> = {};

export async function fetchEmployeeName(employeeId: number): Promise<string> {
  if (employeeCache[employeeId]) return employeeCache[employeeId];
  
  try {
    const res = await fetch(`${DEPUTY_BASE}/resource/Employee/${employeeId}`, { headers });
    if (!res.ok) return `Staff #${employeeId}`;
    const data = await res.json();
    const name = data.DisplayName || `${data.FirstName || ''} ${data.LastName || ''}`.trim() || `Staff #${employeeId}`;
    employeeCache[employeeId] = name;
    return name;
  } catch {
    return `Staff #${employeeId}`;
  }
}

export async function fetchEmployeeNames(ids: number[]): Promise<Record<number, string>> {
  const uniqueIds = [...new Set(ids)].filter(id => !employeeCache[id]);
  
  if (uniqueIds.length > 0) {
    try {
      // Batch fetch with QUERY
      const body = {
        max: 500,
        search: {
          s1: { field: 'Id', type: 'in', data: uniqueIds }
        }
      };
      const res = await fetch(`${DEPUTY_BASE}/resource/Employee/QUERY`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const employees = await res.json();
        for (const emp of employees) {
          const name = emp.DisplayName || `${emp.FirstName || ''} ${emp.LastName || ''}`.trim() || `Staff #${emp.Id}`;
          employeeCache[emp.Id] = name;
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
    const body = {
      max: 500,
      search: {
        s1: { field: 'Date', type: 'eq', data: date },
        s2: { field: 'OperationalUnit', type: 'in', data: unitIds },
      }
    };
    
    const res = await fetch(`${DEPUTY_BASE}/resource/Roster/QUERY`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    
    if (!res.ok) {
      console.error('Roster fetch failed:', res.status, await res.text());
      return [];
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
    const body = {
      max: 200,
      search: {
        s1: { field: 'Date', type: 'eq', data: date },
        s2: { field: 'OperationalUnit', type: 'in', data: unitIds },
      }
    };
    
    const res = await fetch(`${DEPUTY_BASE}/resource/Roster/QUERY`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    
    if (!res.ok) return [];
    
    const rosters = await res.json();
    if (!Array.isArray(rosters)) return [];
    
    // Absent staff are those with Open = false and no timesheet, or those on Leave units
    // For now, look for any roster with Comment containing "leave" or matching leave unit IDs
    const leaveRosters = rosters.filter((r: any) => 
      r.Open === false || 
      r.Comment?.toLowerCase().includes('leave') ||
      r.Comment?.toLowerCase().includes('sick') ||
      r.Comment?.toLowerCase().includes('absent')
    );
    
    if (leaveRosters.length === 0) {
      // Also try the Leave timesheets approach
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
    const body = {
      max: 200,
      search: {
        s1: { field: 'Date', type: 'eq', data: date },
        s2: { field: 'IsLeave', type: 'eq', data: true },
      }
    };
    
    const res = await fetch(`${DEPUTY_BASE}/resource/Timesheet/QUERY`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
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
