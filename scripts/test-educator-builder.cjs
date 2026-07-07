const ALL_SLOTS_151 = [];
for (let m = 7 * 60; m <= 18 * 60; m += 15) {
  ALL_SLOTS_151.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}
function sm151(s) { const [h, mm] = s.split(':').map(Number); return h * 60 + mm; }

const shiftIn = '10:00', shiftOut = '15:00';
const shiftInM = sm151(shiftIn), shiftOutM = sm151(shiftOut);
const shiftSlots = ALL_SLOTS_151.filter(s => { const m = sm151(s); return m >= shiftInM && m < shiftOutM; });
console.log('slots', shiftSlots.length, shiftSlots[0], shiftSlots[shiftSlots.length - 1]);

const positions = shiftSlots.map(slot => ({ slot, room: 'External Casual', blockType: 'shift', note: '' }));
const start = positions[0];
let j = 1;
while (j < positions.length && positions[j].room === start.room && positions[j].blockType === start.blockType) j++;
console.log('merged block', start.room, j, 'start', start.slot);
console.log('would push?', start.room && start.room !== 'Off Roster');

const lastSlot = positions[j - 1].slot;
const endMins = sm151(lastSlot) + 15;
const slotEndTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
console.log('entryIn', shiftIn, 'entryOut', slotEndTime);
