// @ts-nocheck
import * as https from 'https';
const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const DEPUTY_HOST = "thegroveacademy.au.deputy.com";

function deputyPost(path, body) {
  return new Promise((resolve,reject)=>{
    const data=JSON.stringify(body);
    const req=https.request({hostname:DEPUTY_HOST,path:"/api/v1/"+path,method:"POST",
      headers:{"Authorization":"Bearer "+DEPUTY_TOKEN,"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)}
    },res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>resolve(JSON.parse(d) as any));});
    req.on("error",reject);req.write(data);req.end();
  });
}

function deputyGet(path) {
  return new Promise((resolve,reject)=>{
    const req=https.request({hostname:DEPUTY_HOST,path:"/api/v1/"+path,method:"GET",
      headers:{"Authorization":"Bearer "+DEPUTY_TOKEN}
    },res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>resolve(JSON.parse(d) as any));});
    req.on("error",reject);req.end();
  });
}

export async function fetchRosters(date, unitIds) {
  // supervise/roster/{date} returns the complete roster visible in Deputy's
  // "Week by Area" view. resource/Roster/QUERY omits some shifts.
  const data: any = await deputyGet(`supervise/roster/${date}`);
  const rows = Array.isArray(data) ? data : (data.items || []);
  const unitSet = new Set(unitIds);

  const allEmps: any = await deputyPost("resource/Employee/QUERY", { max: 500 });
  const empMap = new Map(allEmps?.items?.map(e => [e.Id, e.Name]));

  return rows
    .filter((r: any) => unitSet.size === 0 || unitSet.has(r.OperationalUnit))
    .map((r: any) => ({
      employeeId: r.Employee,
      unitId: r.OperationalUnit,
      startTime: r.StartTime,
      endTime: r.EndTime,
      employeeName: empMap.get(r.Employee) || `EmpID:${r.Employee}`
    }));
}

export async function fetchAbsentStaff(date, unitIds) {
  const search = {
    s1: { field: "Date", type: "eq", data: date },
    s2: { field: "IsLeave", type: "eq", data: "true" },
    s3: { field: "Discarded", type: "eq", data: "false" },
  };
  const data = await deputyPost("resource/Timesheet/QUERY", { max: 500, search });
  
  const allEmps: any = await deputyPost("resource/Employee/QUERY", { max: 500 });
  const empMap = new Map(allEmps.items?.map(e => [e.Id, e.Name]));
  
  return (data.items || []).map((r: any) => ({
    employeeId: r.Employee,
    reason: r.EmployeeComment || "Unspecified Leave",
    unitId: r.OperationalUnit,
  })).map(r => ({
      ...r,
      employeeName: empMap.get(r.employeeId) || `EmpID:${r.employeeId}`
  }));
}
