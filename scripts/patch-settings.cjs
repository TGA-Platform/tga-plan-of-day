const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'pages', 'SettingsPage.tsx');
let c = fs.readFileSync(file, 'utf8');

// Find the CENTRE RULES TAB comment (may be garbled) and inject role tab before it
const centreIdx = c.indexOf('CENTRE RULES TAB');
if (centreIdx > -1 && !c.includes("activeTab === 'roles'")) {
  const lineStart = c.lastIndexOf('{/*', centreIdx);
  const insert = "{/* -- ROLE PERMISSIONS TAB -- */}\n      {activeTab === 'roles' && (\n        <RolePermissionsTab />\n      )}\n\n      ";
  c = c.slice(0, lineStart) + insert + c.slice(lineStart);
  console.log('Injected role tab');
} else {
  console.log('Skipped - already present or comment not found');
}

const component = `

// \u2500\u2500\u2500 Role Permissions Tab \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const CONFIGURABLE_ROLES: { key: AppRole; label: string; description: string; color: string; border: string }[] = [
  { key: 'director',     label: 'Director',     description: 'Centre directors \u2014 single centre access',      color: '#6d28d9', border: '#ede9fe' },
  { key: 'area_manager', label: 'Area Manager', description: 'Multi-centre managers \u2014 broader visibility',   color: '#1d4ed8', border: '#dbeafe' },
  { key: 'admin',        label: 'Admin',        description: 'HQ administrators \u2014 full access to everything', color: '#2d5c18', border: '#E2F1DA' },
];

function RolePermissionsTab() {
  const [activeRole, setActiveRole] = useState<AppRole>('director');
  const [rolePerms, setRolePerms] = useState<Record<AppRole, RolePermissions>>({
    director:     getBuiltinDefaults('director'),
    area_manager: getBuiltinDefaults('area_manager'),
    admin:        getBuiltinDefaults('admin'),
  });
  const [loadingPerms, setLoadingPerms] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedRole, setSavedRole] = useState<AppRole | null>(null);
  const [dirty, setDirty] = useState<Record<AppRole, boolean>>({ director: false, area_manager: false, admin: false });
  const [sqlHint, setSqlHint] = useState(false);

  useEffect(() => {
    loadRolePermissions().then(() => setLoadingPerms(false));
  }, []);

  const toggle = (role: AppRole, page: string) => {
    setRolePerms(prev => ({ ...prev, [role]: { ...prev[role], [page]: !prev[role][page] } }));
    setDirty(prev => ({ ...prev, [role]: true }));
  };

  const setAll = (role: AppRole, val: boolean) => {
    setRolePerms(prev => ({ ...prev, [role]: Object.fromEntries(PAGES.map(p => [p.key, val])) }));
    setDirty(prev => ({ ...prev, [role]: true }));
  };

  const reset = (role: AppRole) => {
    setRolePerms(prev => ({ ...prev, [role]: getBuiltinDefaults(role) }));
    setDirty(prev => ({ ...prev, [role]: true }));
  };

  const handleSave = async (role: AppRole) => {
    setSaving(true);
    const ok = await saveRolePermissions(role, rolePerms[role]);
    setSaving(false);
    if (ok) {
      invalidateCache();
      setDirty(prev => ({ ...prev, [role]: false }));
      setSavedRole(role);
      setTimeout(() => setSavedRole(null), 2500);
    } else {
      setSqlHint(true);
    }
  };

  const isAdmin = activeRole === 'admin';
  const current = rolePerms[activeRole];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold" style={{ color: '#050505' }}>Role Permissions</h2>
        <p className="text-sm mt-0.5" style={{ color: '#596570' }}>
          Configure which pages each role can access. Individual user centre access is managed in the Users tab.
        </p>
      </div>

      <div className="px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
        <strong>How it works:</strong> These permissions apply to all users with that role. Admin always has full access.
        Changes take effect on next login.
      </div>

      <div className="grid grid-cols-3 gap-3">
        {CONFIGURABLE_ROLES.map(r => (
          <button key={r.key} onClick={() => setActiveRole(r.key)}
            className="text-left p-4 rounded-xl border-2 transition-all"
            style={activeRole === r.key
              ? { borderColor: r.color, backgroundColor: r.border }
              : { borderColor: '#E2F1DA', backgroundColor: 'white' }}>
            <div className="font-semibold text-sm" style={{ color: activeRole === r.key ? r.color : '#050505' }}>
              {r.label}
              {dirty[r.key] && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-orange-400 align-middle" />}
            </div>
            <div className="text-xs mt-0.5" style={{ color: '#596570' }}>{r.description}</div>
          </button>
        ))}
      </div>

      {loadingPerms ? (
        <div className="text-sm italic" style={{ color: '#596570' }}>Loading\u2026</div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            {isAdmin ? (
              <span className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                Admin always has full access \u2014 not configurable
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold" style={{ color: '#596570' }}>Set all:</span>
                <button onClick={() => setAll(activeRole, true)}
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium"
                  style={{ borderColor: '#5a9228', color: '#5a9228', backgroundColor: 'white' }}>Enable all</button>
                <button onClick={() => setAll(activeRole, false)}
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium"
                  style={{ borderColor: '#d1d5db', color: '#6b7280', backgroundColor: 'white' }}>Disable all</button>
                <button onClick={() => reset(activeRole)}
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium"
                  style={{ borderColor: '#d1d5db', color: '#6b7280', backgroundColor: 'white' }}>\u21ba Reset</button>
              </div>
            )}
            <button
              onClick={() => handleSave(activeRole)}
              disabled={saving || !dirty[activeRole] || isAdmin}
              className="text-xs px-4 py-1.5 rounded-xl font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: savedRole === activeRole ? '#16a34a' : '#5a9228' }}>
              {savedRole === activeRole ? '\u2713 Saved!' : saving ? 'Saving\u2026' : 'Save ' + (CONFIGURABLE_ROLES.find(r => r.key === activeRole)?.label ?? '')}
            </button>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
            {PAGES.map((page, idx) => {
              const enabled = isAdmin ? true : (current[page.key] ?? false);
              return (
                <div key={page.key}
                  className="flex items-center justify-between px-5 py-3.5"
                  style={{ borderBottom: idx < PAGES.length - 1 ? '1px solid #f0f9f0' : 'none', backgroundColor: 'white' }}>
                  <div>
                    <div className="text-sm font-medium" style={{ color: '#050505' }}>{page.label}</div>
                    <div className="text-xs" style={{ color: '#596570' }}>{page.description}</div>
                  </div>
                  <button
                    type="button"
                    disabled={isAdmin}
                    onClick={() => !isAdmin && toggle(activeRole, page.key)}
                    className={\`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors \${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}\`}
                    style={{ backgroundColor: enabled ? '#5a9228' : '#d1d5db' }}>
                    <span
                      className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                      style={{ transform: enabled ? 'translateX(24px)' : 'translateX(4px)' }}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          {sqlHint && (
            <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
              \u26a0\ufe0f Couldn't save to Supabase. Run this SQL in the{' '}
              <a href="https://supabase.com/dashboard/project/tgxpvzlibquqnldgmwho/editor"
                target="_blank" rel="noreferrer" className="underline">Supabase editor</a>{' '}first:
              <pre className="mt-2 text-xs bg-white rounded p-2 overflow-x-auto" style={{ color: '#050505' }}>{\`CREATE TABLE IF NOT EXISTS pod_role_permissions (
  role TEXT PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pod_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role all" ON pod_role_permissions FOR ALL USING (true);\`}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
`;

if (!c.includes('function RolePermissionsTab')) {
  c = c + component;
}

fs.writeFileSync(file, c, 'utf8');
console.log('done. Has RolePermissionsTab:', c.includes('function RolePermissionsTab'));
console.log('Has role tab render:', c.includes("activeTab === 'roles'"));
