/**
 * Role Permissions for Plan of the Day
 * Defines what pages each role can access, with Supabase-backed configuration.
 */

import { SUPABASE_URL, SUPABASE_ANON } from '../config';

export type AppRole = 'admin' | 'area_manager' | 'director' | 'assistant_director';

export interface PagePermission {
  key: string;
  label: string;
  description: string;
}

export const PAGES: PagePermission[] = [
  { key: 'dashboard',  label: 'Dashboard',             description: 'Morning briefing & ratio dashboard' },
  { key: 'ratio',      label: 'Ratio Dashboard',        description: 'Live room-by-room ratio view' },
  { key: 'summary',    label: 'All Centres Summary',    description: 'Cross-centre overview' },
  { key: 'week',       label: 'Week Overview',          description: 'Week-at-a-glance staffing view' },
  { key: 'reporting',  label: 'Reports',                description: 'Attendance & compliance reports' },
  { key: 'config',     label: 'Centre Configuration',   description: 'Room & break configuration' },
  { key: 'settings',   label: 'Settings / User Mgmt',   description: 'User management & role permissions' },
];

export type RolePermissions = Record<string, boolean>;
export type RolePermissionMap = Record<AppRole, RolePermissions>;

/** Built-in defaults — used when no Supabase config exists */
export function getBuiltinDefaults(role: AppRole): RolePermissions {
  switch (role) {
    case 'admin':
      return Object.fromEntries(PAGES.map(p => [p.key, true]));
    case 'area_manager':
      return Object.fromEntries(PAGES.map(p => [p.key, p.key !== 'settings']));
    case 'director':
      return {
        dashboard: true,
        ratio:     true,
        summary:   true,
        week:      true,
        reporting: true,
        config:    false,
        settings:  false,
      };
    case 'assistant_director':
      // Assistant Directors: Plan of Day + Ratio Check + Summary. No reports/config/settings.
      return {
        dashboard: true,
        ratio:     true,
        summary:   true,
        week:      false,
        reporting: false,
        config:    false,
        settings:  false,
      };
  }
}

// ── Supabase-backed cache ─────────────────────────────────────────────────────

let _cache: RolePermissionMap | null = null;
let _loading: Promise<void> | null = null;

export async function loadRolePermissions(): Promise<void> {
  if (_cache) return;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pod_role_permissions?select=role,permissions`,
        { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
      );
      if (res.ok) {
        const rows: { role: string; permissions: RolePermissions }[] = await res.json();
        const map: RolePermissionMap = {
          admin:              { ...getBuiltinDefaults('admin') },
          area_manager:       { ...getBuiltinDefaults('area_manager') },
          director:           { ...getBuiltinDefaults('director') },
          assistant_director: { ...getBuiltinDefaults('assistant_director') },
        };
        for (const row of rows) {
          const r = row.role as AppRole;
          if (r in map) map[r] = { ...getBuiltinDefaults(r), ...row.permissions };
        }
        _cache = map;
        return;
      }
    } catch { /* fall through */ }
    // Fallback to built-in defaults
    _cache = {
      admin:              getBuiltinDefaults('admin'),
      area_manager:       getBuiltinDefaults('area_manager'),
      director:           getBuiltinDefaults('director'),
      assistant_director: getBuiltinDefaults('assistant_director'),
    };
  })();

  return _loading;
}

export async function saveRolePermissions(role: AppRole, permissions: RolePermissions): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pod_role_permissions`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ role, permissions }),
    });
    if (res.ok || res.status === 200 || res.status === 201) {
      // Update local cache
      if (_cache) _cache[role] = { ...permissions };
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

/** Get permission for a page — returns cached result or built-in default */
export function canAccess(userRole: string, page: string): boolean {
  // admin / ceo always has full access
  if (userRole === 'admin' || userRole === 'ceo') return true;
  const role = userRole as AppRole;
  if (_cache) return _cache[role]?.[page] ?? false;
  return getBuiltinDefaults(role)?.[page] ?? false;
}

/** Invalidate cache (e.g. after saving) */
export function invalidateCache(): void {
  _cache = null;
  _loading = null;
}
