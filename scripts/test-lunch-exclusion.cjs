const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function slotToMins(slot) {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m;
}

function overlapsWith(slotStart, slotEnd, lunchStart, lunchEnd) {
  const lS = slotToMins(lunchStart);
  const lE = slotToMins(lunchEnd);
  return slotStart < lE && slotEnd > lS;
}

(async () => {
  try {
    console.log('Testing lunch break exclusion logic on staging...\n');
    
    const url = 'https://tga-plan-of-5ue75nz68-matthew-maleks-projects.vercel.app/api/ratio-check?centre_id=all&date=2026-07-23';
    const result = await fetchUrl(url);
    
    if (!result || !result.length) {
      console.log('No ratio check data found for 2026-07-23');
      process.exit(0);
    }

    console.log(`Found data for ${result.length} centre(s)\n`);
    
    for (const row of result) {
      const centre = row.centre_id;
      const ratioData = row.data;
      const overrides = ratioData.staffTimeOverrides || {};
      
      // Find staff with lunch times
      const staffWithLunch = [];
      for (const [empIdStr, ov] of Object.entries(overrides)) {
        if (ov.lunchStart && ov.lunchEnd) {
          staffWithLunch.push({ empId: empIdStr, ...ov });
        }
      }
      
      if (staffWithLunch.length === 0) continue;
      
      console.log(`\n=== ${centre} ===`);
      console.log(`Staff with lunch breaks: ${staffWithLunch.length}\n`);
      
      for (const staff of staffWithLunch) {
        const lunchStart = staff.lunchStart;
        const lunchEnd = staff.lunchEnd;
        const lS = slotToMins(lunchStart);
        const lE = slotToMins(lunchEnd);
        
        console.log(`EmpId ${staff.empId}: Lunch ${lunchStart}-${lunchEnd}`);
        console.log(`  Source: ${staff.source || 'unknown'}`);
        console.log(`  Lunch window in minutes: ${lS}-${lE}`);
        
        // Check which midday slots overlap with this lunch
        const MIDDAY_SLOTS = [
          '10:00','10:15','10:30','10:45',
          '11:00','11:15','11:30','11:45',
          '12:00','12:15','12:30','12:45',
          '13:00','13:15','13:30','13:45',
        ];
        
        const overlappingSlots = [];
        for (const slot of MIDDAY_SLOTS) {
          const slotStart = slotToMins(slot);
          const slotEnd = slotStart + 15; // 15-min slot
          if (overlapsWith(slotStart, slotEnd, lunchStart, lunchEnd)) {
            overlappingSlots.push(slot);
          }
        }
        
        if (overlappingSlots.length > 0) {
          console.log(`  ✓ Should be EXCLUDED from slots: ${overlappingSlots.join(', ')}`);
          console.log(`  ✓ Should APPEAR in lunch column during: ${overlappingSlots.join(', ')}`);
        } else {
          console.log(`  ⚠ No overlap with midday slots (13:45-14:00 boundary?)`);
        }
        console.log('');
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
