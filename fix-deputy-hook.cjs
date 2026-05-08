const fs = require("fs");
const c = fs.readFileSync("C:/Users/ClaudeAI/.openclaw/workspace/tga-plan-of-day/src/hooks/useLiveData.ts", "utf8");
const apiImportIdx = c.indexOf("import { fetchRosters } from '../deputyApi';");
if (apiImportIdx < 0) {
  // Add import
  c = c.replace("import { useState, useEffect, useCallback } from 'react';", 
    "import { useState, useEffect, useCallback } from 'react';\nimport { fetchRosters, fetchAbsentStaff } from '../deputyApi';");
}

// Find the loadDay useEffect and replace the placeholder logic
const loadIdx = c.indexOf("const loadDay = useCallback(async (dateObj: Date): Promise<DaySummary> => {");
const oldLogic = c.substring(loadIdx, c.indexOf("}, [weekOffset]);", loadIdx));
console.log("Old loadDay logic found.");

const newLogic = `  const loadDay = useCallback(async (dateObj: Date): Promise<DaySummary> => {
    const date = formatDate(dateObj);
    
    // 1. Get Attendance Override (from localStorage)
    const totalChildren = centre.rooms.reduce((sum, room) => {
      return sum + getAttendance(date, room.id);
    }, 0);
    
    // 2. Fetch Deputy Roster and Absences
    try {
      const oatleyUnitIds = ['213','132','133','196','159','223','224']; // Oatley IDs
      const [rosters, absents] = await Promise.all([
        fetchRosters(date, oatleyUnitIds),
        fetchAbsentStaff(date, oatleyUnitIds)
      ]);
      
      // Map staff names from Deputy IDs
      const empMap = new Map(rosters.map(r => [r.employeeId, r.employeeName]));
      
      // Calculate Rostered Staff Count
      const roomUnitIds = new Set(centre.rooms.map(r => r.deputyUnitId));
      const uniqueStaff = new Set(
        rosters.filter(r => roomUnitIds.has(r.unitId)).map(r => r.employeeId)
      );
      const staffRostered = uniqueStaff.size;
      
      // Build Absent Staff list
      const absentStaffList = absents.map(a => ({
        employeeName: empMap.get(a.employeeId) || \`EmpID:\${a.employeeId}\`,
        reason: a.reason || "Unknown",
        unitId: a.unitId
      }));

      // Recalculate totals using real data
      const staffRequired = centre.rooms.reduce((sum, room) => {
        const attendance = getAttendance(date, room.id);
        return sum + getStaffRequired(attendance, room.ratio);
      }, 0);
      
      const status = getStatus(staffRostered, staffRequired);
      
      // Store absent staff list in state (via global context or direct return if simple)
      // For now, we just return the rostered count and status
      
      return { date, dateObj, totalChildren, staffRequired, staffRostered, status, loading: false, error: undefined };
    } catch (e) {
      console.error('Deputy fetch error:', e.message);
      return { date, dateObj, totalChildren, staffRequired: 0, staffRostered: 0, status: 'red', loading: false, error: 'Deputy API Failed' };
    }
  }, [weekOffset, safeDate, centre.rooms, loadDay, getAttendance]);`;

  c = c.replace(oldLogic, newLogic);
}

fs.writeFileSync("src/hooks/useLiveData.ts", c, "utf8");
console.log("Fixed loadDay to use Deputy roster and absence fetching");