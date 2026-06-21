const fs = require('fs');
const filePath = require('path').join(__dirname, '..', 'src', 'components', 'RatioCheckPanel.tsx');
let c = fs.readFileSync(filePath, 'utf8');

// Add Lunch Start/End fields to the time editor modal
// Insert after the Finish row and before the buttons div
const finishRow = `              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { updateStaffTimeOverride(timeEditorModal.empId, timeEditorStart, timeEditorEnd); setTimeEditorModal(null); }}`;

const lunchFields = `              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: '#374151', minWidth: '46px' }}>Lunch</span>
                <input type="time" value={timeEditorLunchStart} onChange={e => setTimeEditorLunchStart(e.target.value)}
                  style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }} />
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>–</span>
                <input type="time" value={timeEditorLunchEnd} onChange={e => setTimeEditorLunchEnd(e.target.value)}
                  style={{ fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 8px', flex: 1 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { updateStaffTimeOverride(timeEditorModal.empId, timeEditorStart, timeEditorEnd, timeEditorLunchStart || undefined, timeEditorLunchEnd || undefined); setTimeEditorModal(null); }}`;

if (c.includes(finishRow)) {
  c = c.replace(finishRow, lunchFields);
  console.log('✓ Lunch Start/End fields added to time editor modal');
} else {
  console.warn('✗ finishRow not found');
  // Try CRLF
  const finishRowCRLF = finishRow.replace(/\n/g, '\r\n');
  if (c.includes(finishRowCRLF)) {
    c = c.replace(finishRowCRLF, lunchFields.replace(/\n/g, '\r\n'));
    console.log('✓ Lunch fields added (CRLF)');
  } else {
    console.warn('✗ also not found with CRLF');
  }
}

fs.writeFileSync(filePath, c, 'utf8');

const verify = fs.readFileSync(filePath, 'utf8');
console.log('timeEditorLunchStart in JSX:', verify.includes('timeEditorLunchStart}'));
console.log('lunchStart passed to updateStaffTimeOverride:', verify.includes('timeEditorLunchStart || undefined'));
