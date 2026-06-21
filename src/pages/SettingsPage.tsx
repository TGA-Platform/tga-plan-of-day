/**
 * Settings — CEO only.
 * Manage users (add, edit, remove) and per-user centre access.
 * Users are stored in Supabase app_users table; config users remain as fallback.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { CENTRES, USERS } from '../config';
import { getUser, saveUserAccess, refreshAccessCache } from '../auth';
import { loadCentreRules, saveCentreRule, deleteCentreRule } from '../utils/centreRules';
import type { CentreRule, BreakSubtype } from '../utils/centreRules';
import {
  PAGES,
  getBuiltinDefaults,
  loadRolePermissions,
  saveRolePermissions,
  invalidateCache,
  type AppRole,
  type RolePermissions,
} from '../lib/rolePermissions';

interface AppUser {
  email:    string;
  name:     string;
  role:     'admin' | 'ceo' | 'area_manager' | 'director' | 'assistant_director';
  centreId: string | null;  // primary centre
  password: string;         // plain text (internal tool)
  fromDb:   boolean;        // false = config-only, can't delete
  allowedCentreIds: string[];
  dirty:    boolean;
  saving:   boolean;
}

const BLANK_USER: Omit<AppUser, 'dirty' | 'saving' | 'fromDb' | 'allowedCentreIds'> = {
  email: '', name: '', role: 'director', centreId: null, password: '',
};

const ROLE_LABELS: Record<string, string> = {
  admin:              'Admin',
  ceo:                'Admin (legacy)',
  area_manager:       'Area Manager',
  director:           'Director',
  assistant_director: 'Assistant Director',
};

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  admin:              { bg: '#E2F1DA', text: '#2d5c18' },
  ceo:                { bg: '#E2F1DA', text: '#2d5c18' },
  area_manager:       { bg: '#dbeafe', text: '#1d4ed8' },
  director:           { bg: '#ede9fe', text: '#6d28d9' },
  assistant_director: { bg: '#fef3c7', text: '#92400e' },
};

export default function SettingsPage() {
  const navigate = useNavigate();
  const me = getUser();
  const [users, setUsers]         = useState<AppUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editingEmail, setEditing] = useState<string | null>(null);
  const [addOpen, setAddOpen]     = useState(false);
  const [newUser, setNewUser]     = useState({ ...BLANK_USER });
  const [newUserCentreIds, setNewUserCentreIds] = useState<string[]>([]);
  const [flash, setFlash]         = useState<string | null>(null);
  const [accessMap, setAccessMap] = useState<Record<string, string[]>>({});
  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'rules'>('users');

  // Centre rules state
  const [rules, setRules]           = useState<CentreRule[]>([]);
  const [ruleFormOpen, setRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState<CentreRule | null>(null);
  const BLANK_RULE = { type: 'break_window' as const, subtype: 'lunch' as BreakSubtype, label: 'Lunch', start_time: '11:30', end_time: '14:00', duration_mins: 30, centre_ids: ['*'] as string[] };
  const [ruleForm, setRuleFormData] = useState(BLANK_RULE);

  // CEO guard
  useEffect(() => {
    if (!me || (me.role !== 'admin' && me.role !== 'ceo')) navigate('/summary', { replace: true });
  }, [me, navigate]);

  // Load users from Supabase + config
  useEffect(() => {
    async function load() {
      setLoading(true);
      // Load access settings
      try {
        const lsRaw = localStorage.getItem('tga_pod_access');
        const local: Record<string, string[]> = lsRaw ? JSON.parse(lsRaw) : {};
        const r = await fetch('/api/user-settings');
        const remote: { email: string; allowed_centre_ids: string[] }[] = r.ok ? await r.json() : [];
        const remoteMap = Object.fromEntries(remote.map(s => [s.email.toLowerCase(), s.allowed_centre_ids]));
        setAccessMap({ ...local, ...remoteMap });
      } catch { /* use empty */ }

      // Load DB users
      let dbUsers: { email: string; name: string; role: string; centre_id: string | null }[] = [];
      try {
        const r = await fetch('/api/users');
        if (r.ok) dbUsers = await r.json();
      } catch { /* table may not exist yet */ }

      const dbEmails = new Set(dbUsers.map(u => u.email.toLowerCase()));

      const merged: AppUser[] = [
        // DB users first
        ...dbUsers.map(u => ({
          email:    u.email,
          name:     u.name,
          role:     (u.role as AppUser['role']) ?? 'director',
          centreId: u.centre_id,
          password: '••••••••',  // don't show real password
          fromDb:   true,
          allowedCentreIds: accessMap[u.email.toLowerCase()] ?? (['admin','ceo'].includes(u.role) ? ['*'] : u.centre_id ? [u.centre_id] : []),
          dirty: false,
          saving: false,
        })),
        // Config users not yet in DB (read-only, can push to DB)
        ...USERS.filter(u => !dbEmails.has(u.email.toLowerCase())).map(u => ({
          email:    u.email,
          name:     u.name,
          role:     u.role as AppUser['role'],
          centreId: u.centreId ?? null,
          password: '',
          fromDb:   false,
          allowedCentreIds: accessMap[u.email.toLowerCase()] ?? (['admin','ceo'].includes(u.role) ? ['*'] : u.centreId ? [u.centreId] : []),
          dirty: false,
          saving: false,
        })),
      ].sort((a, b) => a.name.localeCompare(b.name));

      setUsers(merged);
      setLoading(false);
    }
    load();
    loadCentreRules().then(setRules);
  }, []); // eslint-disable-line

  function update(email: string, patch: Partial<AppUser>) {
    setUsers(prev => prev.map(u => u.email === email ? { ...u, ...patch, dirty: true } : u));
  }

  async function saveUser(email: string) {
    const u = users.find(x => x.email === email);
    if (!u) return;
    setUsers(prev => prev.map(x => x.email === email ? { ...x, saving: true } : x));
    try {
      // Save to app_users
      await fetch('/api/users', {
        method: u.fromDb ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:    u.email,
          name:     u.name,
          role:     u.role,
          centreId: u.centreId,
          ...(u.password && u.password !== '••••••••' ? { password: u.password } : {}),
        }),
      });
      // Save centre access
      await saveUserAccess(u.email, u.allowedCentreIds);
      await refreshAccessCache();
      setUsers(prev => prev.map(x => x.email === email ? { ...x, fromDb: true, saving: false, dirty: false } : x));
      setEditing(null);
      showFlash('Saved ✅');
    } catch (e) {
      setUsers(prev => prev.map(x => x.email === email ? { ...x, saving: false } : x));
    }
  }

  async function removeUser(email: string) {
    if (!confirm(`Remove ${email}? They will no longer be able to log in.`)) return;
    await fetch(`/api/users?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
    setUsers(prev => prev.filter(u => u.email !== email));
    showFlash('User removed');
  }

  async function addUser() {
    if (!newUser.email || !newUser.name || !newUser.password) {
      showFlash('Name, email and password are required');
      return;
    }
    const r = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    });
    if (!r.ok) { showFlash('Error saving — is the Supabase table created?'); return; }
    // Also set default access
    const defaultAccess = ['admin','ceo'].includes(newUser.role) ? ['*'] : newUser.role === 'area_manager' ? newUserCentreIds : newUser.centreId ? [newUser.centreId] : [];
    await saveUserAccess(newUser.email, defaultAccess);
    setUsers(prev => [...prev, {
      ...newUser, fromDb: true, allowedCentreIds: defaultAccess, dirty: false, saving: false,
    }].sort((a, b) => a.name.localeCompare(b.name)));
    setNewUser({ ...BLANK_USER });
    setNewUserCentreIds([]);
    setAddOpen(false);
    showFlash('User added ✅');
  }

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  }

  async function handleSaveRule() {
    const payload = editingRule ? { ...ruleForm, id: editingRule.id } : ruleForm;
    const saved = await saveCentreRule(payload);
    if (saved) {
      setRules(prev => editingRule
        ? prev.map(r => r.id === saved.id ? saved : r)
        : [...prev, saved]
      );
      setRuleFormData(BLANK_RULE);
      setEditingRule(null);
      setRuleForm(false);
      showFlash('Rule saved ✅');
    } else {
      showFlash('⚠️ Run the Supabase SQL to enable centre rules (see below)');
    }
  }

  async function handleDeleteRule(id: string) {
    await deleteCentreRule(id);
    setRules(prev => prev.filter(r => r.id !== id));
    showFlash('Rule deleted');
  }

  if (!me || (me.role !== 'admin' && me.role !== 'ceo')) return null;

  const inputCls = 'w-full border rounded-xl px-3 py-2 text-sm focus:outline-none';
  const inputStyle = { borderColor: '#D0E8B8', color: '#050505' };

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#050505' }}>User Management</h1>
          <p className="text-sm mt-0.5" style={{ color: '#596570' }}>
            Add, edit or remove users · Manage centre access
          </p>
        </div>
        <div className="flex items-center gap-3">
          {flash && (
            <span className="text-sm font-semibold px-3 py-1.5 rounded-xl"
              style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>{flash}</span>
          )}
          <button onClick={() => setAddOpen(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#5a9228' }}>
            + Add User
          </button>
          <button onClick={() => navigate('/summary')}
            className="border rounded-xl px-4 py-2 text-sm font-semibold"
            style={{ borderColor: '#D0E8B8', color: '#5a9228' }}>
            ← Back
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['users','roles','rules'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="px-5 py-2 rounded-xl text-sm font-semibold transition-all"
            style={activeTab === tab
              ? { backgroundColor: '#2d5c18', color: 'white' }
              : { backgroundColor: 'white', color: '#2d5c18', border: '1px solid #D0E8B8' }}>
            {tab === 'users' ? 'Users' : tab === 'roles' ? 'Role Permissions' : 'Centre Rules'}
          </button>
        ))}
      </div>

      {/* -- ROLE PERMISSIONS TAB -- */}
      {activeTab === 'roles' && (
        <RolePermissionsTab />
      )}

      {/* ── CENTRE RULES TAB ── */}
      {activeTab === 'rules' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: '#596570' }}>Configure rules that apply to all or specific centres — break windows are used to auto-suggest float schedules.</p>
            <button onClick={() => { setEditingRule(null); setRuleFormData(BLANK_RULE); setRuleForm(true); }}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: '#5a9228' }}>+ Add Rule</button>
          </div>

          {/* Rule form */}
          {ruleFormOpen && (
            <div className="rounded-2xl border p-5" style={{ borderColor: '#D0E8B8', backgroundColor: '#F5FAF3' }}>
              <h3 className="font-bold text-sm mb-4" style={{ color: '#050505' }}>
                {editingRule ? 'Edit Rule' : 'New Rule'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Rule type</label>
                  <select className={inputCls} style={inputStyle} value={ruleForm.subtype ?? ''}
                    onChange={e => {
                      const sub = e.target.value as BreakSubtype;
                      const labels: Record<string,string> = { morning_tea:'Morning Tea', lunch:'Lunch', afternoon_tea:'Afternoon Tea', custom:'Custom' };
                      const defaults: Record<string,{s:string,e:string}> = { morning_tea:{s:'09:30',e:'11:00'}, lunch:{s:'11:30',e:'14:00'}, afternoon_tea:{s:'14:30',e:'16:00'}, custom:{s:'12:00',e:'13:00'} };
                      setRuleFormData(p => ({ ...p, subtype: sub, label: labels[sub]??sub, start_time: defaults[sub]?.s??p.start_time, end_time: defaults[sub]?.e??p.end_time }));
                    }}>
                    <option value="morning_tea">Morning Tea window</option>
                    <option value="lunch">Lunch window</option>
                    <option value="afternoon_tea">Afternoon Tea window</option>
                    <option value="custom">Custom break window</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Label (shown in float plan)</label>
                  <input className={inputCls} style={inputStyle} value={ruleForm.label}
                    onChange={e => setRuleFormData(p => ({ ...p, label: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Window opens (earliest break start)</label>
                  <input type="time" className={inputCls} style={inputStyle} value={ruleForm.start_time}
                    onChange={e => setRuleFormData(p => ({ ...p, start_time: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Window closes (latest break end)</label>
                  <input type="time" className={inputCls} style={inputStyle} value={ruleForm.end_time}
                    onChange={e => setRuleFormData(p => ({ ...p, end_time: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Break duration (minutes)</label>
                  <input type="number" min={10} max={90} className={inputCls} style={inputStyle} value={ruleForm.duration_mins}
                    onChange={e => setRuleFormData(p => ({ ...p, duration_mins: parseInt(e.target.value)||30 }))} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Applies to</label>
                  <select className={inputCls} style={inputStyle}
                    value={ruleForm.centre_ids.includes('*') ? '*' : '__custom__'}
                    onChange={e => setRuleFormData(p => ({ ...p, centre_ids: e.target.value === '*' ? ['*'] : [] }))}>
                    <option value="*">All centres</option>
                    <option value="__custom__">Specific centres…</option>
                  </select>
                </div>
              </div>

              {/* Centre multi-select */}
              {!ruleForm.centre_ids.includes('*') && (
                <div className="mt-3">
                  <label className="text-xs mb-2 block font-semibold" style={{ color: '#5a9228' }}>Select centres</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {CENTRES.map(c => {
                      const checked = ruleForm.centre_ids.includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-xl border cursor-pointer text-xs"
                          style={{ borderColor: checked ? '#5a9228' : '#E2F1DA', backgroundColor: checked ? '#F5FAF3' : 'white' }}>
                          <input type="checkbox" checked={checked} className="accent-green-700"
                            onChange={() => setRuleFormData(p => ({
                              ...p, centre_ids: checked ? p.centre_ids.filter(i=>i!==c.id) : [...p.centre_ids, c.id]
                            }))} />
                          <span style={{ color: '#050505' }}>{c.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button onClick={handleSaveRule}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ backgroundColor: '#5a9228' }}>Save Rule</button>
                <button onClick={() => { setRuleForm(false); setEditingRule(null); setRuleFormData(BLANK_RULE); }}
                  className="px-4 py-2 rounded-xl text-sm font-semibold border"
                  style={{ borderColor: '#D0E8B8', color: '#596570' }}>Cancel</button>
              </div>
            </div>
          )}

          {/* SQL hint */}
          {rules.length === 0 && !ruleFormOpen && (
            <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
              No rules yet. Add a rule above, then run this SQL in{' '}
              <a href="https://supabase.com/dashboard/project/tgxpvzlibquqnldgmwho/editor" target="_blank" rel="noreferrer" className="underline">Supabase</a>{' '}to persist them:
              <pre className="mt-2 text-xs bg-white rounded p-2 overflow-x-auto" style={{ color: '#050505' }}>
{`CREATE TABLE IF NOT EXISTS centre_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL, subtype TEXT,
  label TEXT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  duration_mins INTEGER DEFAULT 30,
  centre_ids JSONB NOT NULL DEFAULT '["*"]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE centre_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role all" ON centre_rules FOR ALL USING (true);`}
              </pre>
            </div>
          )}

          {/* Rules list */}
          {rules.length > 0 && (
            <div className="space-y-2">
              {rules.map(rule => (
                <div key={rule.id} className="rounded-2xl border flex items-center justify-between px-5 py-3"
                  style={{ borderColor: '#E2F1DA', backgroundColor: 'white' }}>
                  <div>
                    <div className="font-semibold text-sm" style={{ color: '#050505' }}>{rule.label} break window</div>
                    <div className="text-xs mt-0.5" style={{ color: '#596570' }}>
                      {rule.start_time}–{rule.end_time} · {rule.duration_mins} min breaks ·{' '}
                      {rule.centre_ids.includes('*') ? 'All centres' : `${rule.centre_ids.length} centre${rule.centre_ids.length !== 1 ? 's' : ''}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingRule(rule); setRuleFormData({ type: rule.type, subtype: rule.subtype??'lunch', label: rule.label, start_time: rule.start_time, end_time: rule.end_time, duration_mins: rule.duration_mins, centre_ids: rule.centre_ids }); setRuleForm(true); }}
                      className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: '#D0E8B8', color: '#5a9228' }}>Edit</button>
                    <button onClick={() => handleDeleteRule(rule.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: '#fca5a5', color: '#dc2626' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
      <>
            {/* Add user form */}
      {addOpen && (
        <div className="rounded-2xl border p-5 mb-6 shadow-sm" style={{ borderColor: '#D0E8B8', backgroundColor: '#F5FAF3' }}>
          <h2 className="font-bold text-sm mb-4" style={{ color: '#050505' }}>New User</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Full name *</label>
              <input className={inputCls} style={inputStyle} placeholder="Jane Smith"
                value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Email *</label>
              <input className={inputCls} style={inputStyle} placeholder="jane@tga.edu.au" type="email"
                value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value.toLowerCase() }))} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Password *</label>
              <input className={inputCls} style={inputStyle} type="text" placeholder="Set a password"
                value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Role</label>
              <select className={inputCls} style={inputStyle}
                value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value as AppUser['role'] }))}>
                <option value="director">Director</option>
                <option value="assistant_director">Assistant Director</option>
                <option value="area_manager">Area Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {newUser.role === 'director' && (
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
            )}
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={addUser}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: '#5a9228' }}>Save User</button>
            <button onClick={() => { setAddOpen(false); setNewUser({ ...BLANK_USER }); }}
              className="px-4 py-2 rounded-xl text-sm font-semibold border"
              style={{ borderColor: '#D0E8B8', color: '#596570' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* User list */}
      {loading ? (
        <div className="text-sm italic" style={{ color: '#596570' }}>Loading users…</div>
      ) : (
        <div className="space-y-3">
          {users.map(u => {
            const isEditing = editingEmail === u.email;
            return (
              <div key={u.email} className="rounded-2xl border overflow-hidden shadow-sm"
                style={{ borderColor: '#E2F1DA', backgroundColor: 'white' }}>
                {/* Row header */}
                <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-2"
                  style={{ backgroundColor: '#F5FAF3' }}>
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-semibold text-sm" style={{ color: '#050505' }}>{u.name}</div>
                      <div className="text-xs" style={{ color: '#596570' }}>{u.email}</div>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: ROLE_COLORS[u.role]?.bg ?? '#f3f4f6', color: ROLE_COLORS[u.role]?.text ?? '#374151' }}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                    {!u.fromDb && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
                        config only
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {isEditing ? (
                      <>
                        <button onClick={() => saveUser(u.email)} disabled={u.saving}
                          className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
                          style={{ backgroundColor: '#5a9228' }}>
                          {u.saving ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditing(null)}
                          className="text-xs px-3 py-1.5 rounded-lg border font-semibold"
                          style={{ borderColor: '#D0E8B8', color: '#596570' }}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditing(u.email)}
                          className="text-xs px-3 py-1.5 rounded-lg border font-semibold"
                          style={{ borderColor: '#D0E8B8', color: '#5a9228' }}>
                          ✏️ Edit
                        </button>
                        {u.fromDb && u.email !== me?.email && (
                          <button onClick={() => removeUser(u.email)}
                            className="text-xs px-3 py-1.5 rounded-lg border font-semibold"
                            style={{ borderColor: '#fca5a5', color: '#dc2626' }}>
                            🗑 Remove
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div className="px-5 py-4 space-y-4 border-t" style={{ borderColor: '#E2F1DA' }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Full name</label>
                        <input className={inputCls} style={inputStyle} value={u.name}
                          onChange={e => update(u.email, { name: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#596570' }}>New password (leave blank to keep)</label>
                        <input className={inputCls} style={inputStyle} type="text"
                          placeholder={u.fromDb ? 'Enter new password to change' : 'Set password to move to DB'}
                          value={u.password === '••••••••' ? '' : u.password}
                          onChange={e => update(u.email, { password: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Role</label>
                        <select className={inputCls} style={inputStyle} value={u.role}
                          onChange={e => update(u.email, { role: e.target.value as AppUser['role'] })}>
                          <option value="director">Director</option>
                          <option value="assistant_director">Assistant Director</option>
                          <option value="area_manager">Area Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#596570' }}>Primary centre</label>
                        <select className={inputCls} style={inputStyle}
                          value={u.centreId ?? ''}
                          onChange={e => update(u.email, { centreId: e.target.value || null })}>
                          <option value="">— none —</option>
                          {CENTRES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Centre access */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5a9228' }}>
                          Centre Access
                        </label>
                        <button
                          onClick={() => update(u.email, { allowedCentreIds: ['*'] })}
                          className="text-xs px-2 py-1 rounded-lg border"
                          style={u.allowedCentreIds.includes('*')
                            ? { backgroundColor: '#2d5c18', color: 'white', borderColor: '#2d5c18' }
                            : { backgroundColor: 'white', color: '#5a9228', borderColor: '#D0E8B8' }}>
                          All Centres
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {CENTRES.map(c => {
                          const checked = u.allowedCentreIds.includes('*') || u.allowedCentreIds.includes(c.id);
                          return (
                            <label key={c.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-xl border cursor-pointer text-xs"
                              style={{ borderColor: checked ? '#5a9228' : '#E2F1DA', backgroundColor: checked ? '#F5FAF3' : 'white' }}>
                              <input type="checkbox" checked={checked}
                                disabled={u.allowedCentreIds.includes('*')}
                                onChange={() => {
                                  const ids = u.allowedCentreIds.includes('*') ? [] : [...u.allowedCentreIds];
                                  const next = ids.includes(c.id) ? ids.filter(i => i !== c.id) : [...ids, c.id];
                                  update(u.email, { allowedCentreIds: next });
                                }}
                                className="accent-green-700" />
                              <span style={{ color: '#050505' }}>{c.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Summary when not editing */}
                {!isEditing && (
                  <div className="px-5 py-2.5 text-xs flex gap-4 flex-wrap" style={{ color: '#596570' }}>
                    <span>
                      <strong>Access:</strong>{' '}
                      {u.allowedCentreIds.includes('*')
                        ? 'All centres'
                        : u.allowedCentreIds.length === 0
                        ? 'No centres set'
                        : u.allowedCentreIds.map(id => CENTRES.find(c => c.id === id)?.name ?? id).join(', ')}
                    </span>
                    {u.centreId && (
                      <span><strong>Primary:</strong> {CENTRES.find(c => c.id === u.centreId)?.name ?? u.centreId}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </Layout>
  );
}

// ─── Role Permissions Tab ─────────────────────────────────────────────────────

const CONFIGURABLE_ROLES: { key: AppRole; label: string; description: string; color: string; border: string }[] = [
  { key: 'director',           label: 'Director',           description: 'Centre directors — single centre access',                       color: '#6d28d9', border: '#ede9fe' },
  { key: 'assistant_director', label: 'Assistant Director', description: 'ADs — single centre, ratio check & summary only',               color: '#92400e', border: '#fef3c7' },
  { key: 'area_manager',       label: 'Area Manager',       description: 'Multi-centre managers — broader visibility',                    color: '#1d4ed8', border: '#dbeafe' },
  { key: 'admin',              label: 'Admin',              description: 'HQ administrators — full access to everything',                  color: '#2d5c18', border: '#E2F1DA' },
];

function RolePermissionsTab() {
  const [activeRole, setActiveRole] = useState<AppRole>('director');
  const [rolePerms, setRolePerms] = useState<Record<AppRole, RolePermissions>>({
    director:           getBuiltinDefaults('director'),
    assistant_director: getBuiltinDefaults('assistant_director'),
    area_manager:       getBuiltinDefaults('area_manager'),
    admin:        getBuiltinDefaults('admin'),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedRole, setSavedRole] = useState<AppRole | null>(null);
  const [dirty, setDirty] = useState<Record<AppRole, boolean>>({ director: false, assistant_director: false, area_manager: false, admin: false });
  const [sqlHint, setSqlHint] = useState(false);

  useEffect(() => {
    loadRolePermissions().then(() => {
      // After loading, rebuild from cache by saving dummy then re-reading
      // Instead: just reload from Supabase directly
      setLoading(false);
    });
  }, []);

  const toggle = (role: AppRole, page: string) => {
    setRolePerms(prev => ({ ...prev, [role]: { ...prev[role], [page]: !prev[role][page] } }));
    setDirty(prev => ({ ...prev, [role]: true }));
  };

  const setAll = (role: AppRole, val: boolean) => {
    const perms = Object.fromEntries(PAGES.map(p => [p.key, val]));
    setRolePerms(prev => ({ ...prev, [role]: perms }));
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
          Configure which pages each role can access. Individual user access is managed in the Users tab.
        </p>
      </div>

      {/* Info banner */}
      <div className="px-4 py-3 rounded-xl text-sm" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
        <strong>How it works:</strong> Permissions apply to all users with that role unless individually overridden.
        Admin always has full access. Changes take effect on next login.
      </div>

      {/* Role selector */}
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

      {loading ? (
        <div className="text-sm italic" style={{ color: '#596570' }}>Loading…</div>
      ) : (
        <div className="space-y-4">
          {/* Actions */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            {isAdmin ? (
              <span className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ backgroundColor: '#E2F1DA', color: '#2d5c18' }}>
                Admin always has full access — not configurable
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
                  style={{ borderColor: '#d1d5db', color: '#6b7280', backgroundColor: 'white' }}>↺ Reset</button>
              </div>
            )}
            <button
              onClick={() => handleSave(activeRole)}
              disabled={saving || !dirty[activeRole] || isAdmin}
              className="text-xs px-4 py-1.5 rounded-xl font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: savedRole === activeRole ? '#16a34a' : '#5a9228' }}>
              {savedRole === activeRole ? '✓ Saved!' : saving ? 'Saving…' : `Save ${CONFIGURABLE_ROLES.find(r=>r.key===activeRole)?.label}`}
            </button>
          </div>

          {/* Page toggles */}
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#E2F1DA' }}>
            {PAGES.map((page, idx) => {
              const enabled = isAdmin ? true : current[page.key] ?? false;
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
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
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

          {/* SQL hint */}
          {sqlHint && (
            <div className="rounded-xl p-4 text-sm" style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
              ⚠️ Couldn't save to Supabase. Run this SQL in the{' '}
              <a href="https://supabase.com/dashboard/project/tgxpvzlibquqnldgmwho/editor"
                target="_blank" rel="noreferrer" className="underline">Supabase editor</a>{' '}first:
              <pre className="mt-2 text-xs bg-white rounded p-2 overflow-x-auto" style={{ color: '#050505' }}>
{`CREATE TABLE IF NOT EXISTS pod_role_permissions (
  role TEXT PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pod_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role all" ON pod_role_permissions FOR ALL USING (true);`}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

