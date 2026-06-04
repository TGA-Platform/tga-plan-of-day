const fs = require('fs');
const file = 'src/pages/SettingsPage.tsx';
let c = fs.readFileSync(file, 'utf8');

// 1. Add newUserCentreIds state after newUser state
c = c.replace(
  "const [newUser, setNewUser]     = useState({ ...BLANK_USER });",
  "const [newUser, setNewUser]     = useState({ ...BLANK_USER });\n  const [newUserCentreIds, setNewUserCentreIds] = useState<string[]>([]);"
);

// 2. Fix addUser defaultAccess to use newUserCentreIds for area_manager
c = c.replace(
  "const defaultAccess = ['admin','ceo'].includes(newUser.role) ? ['*'] : newUser.centreId ? [newUser.centreId] : [];",
  "const defaultAccess = ['admin','ceo'].includes(newUser.role) ? ['*'] : newUser.role === 'area_manager' ? newUserCentreIds : newUser.centreId ? [newUser.centreId] : [];"
);

// 3. Also reset newUserCentreIds when form closes
c = c.replace(
  "setNewUser({ ...BLANK_USER });\n    setAddOpen(false);",
  "setNewUser({ ...BLANK_USER });\n    setNewUserCentreIds([]);\n    setAddOpen(false);"
);

// 4. Also reset after addUser success
c = c.replace(
  "setNewUser({ ...BLANK_USER });\n    setAddOpen(false);\n    showFlash",
  "setNewUser({ ...BLANK_USER });\n    setNewUserCentreIds([]);\n    setAddOpen(false);\n    showFlash"
);

// 5. Replace the director-only centre select with role-aware centre selection
const oldCentreSection = `            {newUser.role === 'director' && (
              <div className="sm:col-span-2">
                <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Primary centre</label>
                <select className={inputCls} style={inputStyle}
                  value={newUser.centreId ?? ''}
                  onChange={e => setNewUser(p => ({ ...p, centreId: e.target.value || null }))}>
                  <option value="">— select —</option>
                  {CENTRES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}`;

const newCentreSection = `            {newUser.role === 'director' && (
              <div className="sm:col-span-2">
                <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Primary centre</label>
                <select className={inputCls} style={inputStyle}
                  value={newUser.centreId ?? ''}
                  onChange={e => setNewUser(p => ({ ...p, centreId: e.target.value || null }))}>
                  <option value="">— select —</option>
                  {CENTRES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {newUser.role === 'area_manager' && (
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5a9228' }}>
                    Centre Access
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewUserCentreIds(newUserCentreIds.length === CENTRES.length ? [] : CENTRES.map(c => c.id))}
                    className="text-xs px-2 py-1 rounded-lg border"
                    style={{ borderColor: '#D0E8B8', color: '#5a9228', backgroundColor: 'white' }}>
                    {newUserCentreIds.length === CENTRES.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {CENTRES.map(centre => {
                    const checked = newUserCentreIds.includes(centre.id);
                    return (
                      <label key={centre.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-xl border cursor-pointer text-xs"
                        style={{ borderColor: checked ? '#5a9228' : '#E2F1DA', backgroundColor: checked ? '#F5FAF3' : 'white' }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => {
                            setNewUserCentreIds(prev =>
                              prev.includes(centre.id) ? prev.filter(id => id !== centre.id) : [...prev, centre.id]
                            );
                          }}
                          className="accent-green-700" />
                        <span style={{ color: '#050505' }}>{centre.name}</span>
                      </label>
                    );
                  })}
                </div>
                {newUserCentreIds.length > 0 && (
                  <p className="text-xs mt-2" style={{ color: '#5a9228' }}>
                    {newUserCentreIds.length} centre{newUserCentreIds.length !== 1 ? 's' : ''} selected
                  </p>
                )}
              </div>
            )}`;

c = c.replace(oldCentreSection, newCentreSection);

fs.writeFileSync(file, c, 'utf8');
console.log('Done.');
console.log('Has newUserCentreIds state:', c.includes('newUserCentreIds, setNewUserCentreIds'));
console.log('Has multi-centre checkbox:', c.includes('area_manager' + "' && ("));
console.log('Has select all button:', c.includes('Select all'));
