const centreId = 'wollongong';
const campus = 'Wollongong';
const date = '2026-07-06';
fetch(`http://localhost:3000/api/room-forecast?campus=${encodeURIComponent(campus)}&date=${date}&centreId=${encodeURIComponent(centreId)}`)
  .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(t); }))
  .then(d => console.log(JSON.stringify(d, null, 2)))
  .catch(e => console.log('ERR', e.message));
