const fs = require("fs");
const c = fs.readFileSync("C:/Users/ClaudeAI/.openclaw/workspace/tga-plan-of-day/src/hooks/useLiveData.ts", "utf8");

// Locate the start of the loadDay function
const loadIdx = c.indexOf("const loadDay = useCallback(");

// Replace the entire function body from there to the end of its dependency array
const endIdx = c.indexOf("], [weekOffset]);", loadIdx);

const newLoadDay = `  const loadDay = useCallback(async (dateObj: Date): Promise<DaySummary> => {
    const date = formatDate(dateObj);
    setLoading(true);

    // 1. Get Attendance Override (from localStorage)
    const totalChildren = centre.rooms.reduce((sum, room) => {
      return sum + getAttendance(date, room.id);
    }, 0);
    
    // 2. Fetch Deputy Roster and Absences
    try {
      const oatleyUnitIds = ['213','132','133','196','159','223','224'];
      const [rosters, absents] = await Promise.all([
        fetchRosters(date, oatleyUnitIds),
        fetchAbsentStaff(date, oatleyUnitIds)
      ]);
      
      // Map staff names from Deputy IDs
      const empMap = new Map(rosters.map(r => [r.employeeId, r.employeeName]));
      
      // Calculate Rostered Staff Count
      const roomUnits = new Set(centre.rooms.map(r => r.deputyUnitId));
      const uniqueStaff = new Set(
        rosters.filter(r => roomUnits.has(r.unitId)).map(r => ({
          name: empMap.get(r.employeeId) || \`EmpID:\${r.employeeId}\`,
          startTime: r.startTime,
          endTime: r.endTime
        }))
      );
      const staffRostered = uniqueStaff.size;
      
      // Build Absent Staff list for return
      const absentStaffList = absents.map(a => ({
        employeeName: empMap.get(a.employeeId) || \`EmpID:\${a.employeeId}\`,
        reason: a.reason || "Unspecified Leave",
        unitId: a.unitId
      }));
      
      // Recalculate totals using real data
      const staffRequired = centre.rooms.reduce((sum, room) => {
        const attendance = getAttendance(date, room.id);
        return sum + getStaffRequired(attendance, room.ratio);
      }, 0);
      
      const status = getStatus(staffRostered, staffRequired);
      
      return { date, dateObj, totalChildren, staffRequired, staffRostered, status, loading: false, error: undefined, rawRosters: rosters, rawAbsents: absents, uniqueStaff, absentStaffList };
    } catch (e) {
      console.error('Deputy fetch error:', e.message);
      return { date, dateObj, totalChildren, staffRequired: 0, staffRostered: 0, status: 'red', loading: false, error: 'Deputy API Failed' };
    }
  }, [weekOffset, safeDate, centre.rooms, getAttendance, getStaffRequired, getStatus]);`;
    
  c = c.substring(0, loadIdx) + newLoadDay + c.substring(endIdx);
}

fs.writeFileSync("src/hooks/useLiveData.ts", c, "utf8");
console.log("Fixed loadDay logic for Deputy API");