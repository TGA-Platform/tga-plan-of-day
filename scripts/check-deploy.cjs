fetch('https://tga-plan-of-qxyyzg8lh-matthew-maleks-projects.vercel.app/')
  .then(r => r.text())
  .then(html => {
    const m = html.match(/src="([^"]+\.js)"/);
    if (!m) { console.log('no js found'); return; }
    const jsUrl = 'https://tga-plan-of-qxyyzg8lh-matthew-maleks-projects.vercel.app' + m[1];
    return fetch(jsUrl).then(r => r.text());
  })
  .then(js => {
    if (!js) return;
    console.log('has staff-allocations:', js.includes('staff-allocations'));
    console.log('has z-casuals timeout:', js.includes('z-casuals timeout'));
  })
  .catch(e => console.error(e));
