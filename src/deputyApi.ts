import * as https from 'https';
const DEPUTY_TOKEN = 'cf73b1628a5e3498d713879bcf07a974';
const DEPUTY_HOST = "thegroveacademy.au.deputy.com";

function deputyPost(path, body) {
  return new Promise((resolve,reject)=>{
    const data=JSON.stringify(body);
    const req=https.request({hostname:DEPUTY_HOST,path:"/api/v1/"+path,method:"POST",
      headers:{"Authorization":"Bearer "+DEPUTY_TOKEN,"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)}
    },res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>resolve(JSON.parse(d)));});
    req.on("error",reject);req.write(data);req.end();
  });
}

export async function fetchRosters(date, unitIds) {
  const search = {
    s1: { field: "Date", type: "eq", data: date },
    s2: { field: "OperationalUnit", type: "in", data: unitIds },
    s3: { field: "IsLeave", type: "eq", data: "false" },
    s4: { field: "Discarded", type: "eq", data: "false" },
  };
  const data = await deputyPost("resource/Roster/QUERY", { max: 500, search });
  
  const allEmps = await deputyPost("resource/Employee/QUERY", { max: 500 });
  const empMap = new Map(allEmps.items?.map(e => [e.Id, e.Name]));
  
  return (data.items || []).map(r => ({
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
  
  const allEmps = await deputyPost("resource/Employee/QUERY", { max: 500 });
  const empMap = new Map(allEmps.items?.map(e => [e.Id, e.Name]));
  
  return (data.items || []).map(r => ({
    employeeId: r.Employee,
    reason: r.EmployeeComment || "Unspecified Leave",
    unitId: r.OperationalUnit,
  })).map(r => ({
      ...r,
      employeeName: empMap.get(r.employeeId) || `EmpID:${r.employeeId}`
  }));
}
