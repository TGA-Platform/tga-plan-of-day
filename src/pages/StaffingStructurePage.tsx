import { useState, useEffect, useMemo } from 'react';
import type { StaffMember } from '../types';
import { CENTRES } from '../config';
import { getUser } from '../auth';

// ── Helpers ───────────────────────────────────────────────────────────────

const QUAL_COLOURS: Record<string, { bg: string; text: string; label: string }> = {
  'ECT':           { bg: '#dbeafe', text: '#1e40af', label: 'ECT' },
  'WT ECT':        { bg: '#ede9fe', text: '#5b21b6', label: 'WT ECT' },
  'Diploma':       { bg: '#dcfce7', text: '#166534', label: 'DIP' },
  'Certificate 3': { bg: '#fef9c3', text: '#854d0e', label: 'CERT3' },
  'Trainee':       { bg: '#ffedd5', text: '#9a3412', label: 'TRAINEE' },
  'ISS':           { bg: '#f3e8ff', text: '#7e22ce', label: 'ISS' },
  'Chef':          { bg: '#fce7f3', text: '#9d174d', label: 'CHEF' },
  'PPL':           { bg: '#e0f2fe', text: '#0369a1', label: 'PPL' },
  'Resigned':      { bg: '#f1f5f9', text: '#94a3b8', label: 'LEFT' },
};

function qualBadge(qual: string) {
  const c = QUAL_COLOURS[qual] ?? { bg: '#f1f5f9', text: '#64748b', label: qual?.slice(0, 6) ?? '?' };
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-xs font-bold"
      style={{ backgroundColor: c.bg, color: c.text }}>
      {c.label}
    </span>
  );
}

/** Days until ISO date. Negative = expired. */
function daysUntil(isoDate?: string): number | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}

function complianceStatus(days: number | null): 'ok' | 'warning' | 'expired' | 'missing' {
  if (days === null) return 'missing';
  if (days < 0) return 'expired';
  if (days <= 90) return 'warning';
  return 'ok';
}

function CompliancePill({ label, expiry, code }: { label: string; expiry?: string; code?: string }) {
  const days = daysUntil(expiry);
  const status = complianceStatus(days);
  const colours = {
    ok:      { bg: '#dcfce7', text: '#166534', icon: '✅' },
    warning: { bg: '#fef9c3', text: '#854d0e', icon: '⚠️' },
    expired: { bg: '#fee2e2', text: '#991b1b', icon: '🔴' },
    missing: { bg: '#f1f5f9', text: '#64748b', icon: '—' },
  }[status];

  const dateStr = expiry
    ? new Date(expiry).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : undefined;

  return (
    <div className="flex items-start gap-1.5 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-sm w-4 flex-shrink-0 mt-0.5">{colours.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-gray-700">{label}</div>
        {code && <div className="text-xs text-gray-500">{code}</div>}
        {dateStr ? (
          <div className="text-xs" style={{ color: colours.text }}>
            {status === 'expired' ? `Expired ${dateStr}` :
             status === 'warning' ? `Expires ${dateStr} (${days}d)` :
             `Expires ${dateStr}`}
          </div>
        ) : (
          <div className="text-xs text-gray-400">Not recorded</div>
        )}
      </div>
    </div>
  );
}

function DocLink({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors group">
      <span className="text-base">📄</span>
      <span className="text-gray-700 group-hover:text-blue-700 truncate">{label}</span>
      <span className="ml-auto text-gray-300 group-hover:text-blue-400">↗</span>
    </a>
  );
}

// ── Staff Card (slide-in detail panel) ────────────────────────────────────

function StaffCard({ staff, onClose }: { staff: StaffMember; onClose: () => void }) {
  const comp = staff.compliance;

  const complianceItems: { label: string; expiry?: string; code?: string }[] = [
    { label: 'WWCC',                 expiry: comp.wwccExpiry,           code: comp.wwccNumber },
    { label: 'First Aid',            expiry: comp.firstAidExpiry,       code: comp.firstAidCode },
    { label: 'CPR',                  expiry: comp.cprExpiry,            code: comp.cprCode },
    { label: 'Anaphylaxis',         expiry: comp.anaphylaxisExpiry,    code: comp.anaphylaxisCode },
    { label: 'Child Protection',     expiry: comp.childProtectionRenewal },
  ];

  const allDocs = [...staff.docs, ...staff.certDocs];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-5 pt-5 pb-4 border-b border-gray-100 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-900 leading-tight">{staff.name}</h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {qualBadge(staff.qualification)}
                {staff.position && (
                  <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                    {staff.position}
                  </span>
                )}
                {staff.positionCategory && (
                  <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">
                    {staff.positionCategory}
                  </span>
                )}
                {staff.action && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                    {staff.action}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 px-5 py-4 space-y-5">
          {/* Employment */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Employment</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {staff.startDate && (
                <>
                  <span className="text-gray-500">Start date</span>
                  <span className="font-medium text-gray-800">
                    {new Date(staff.startDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </>
              )}
              {staff.endDate && staff.endDate !== 'Not Applicable' && (
                <>
                  <span className="text-gray-500">End date</span>
                  <span className="font-medium text-gray-800">{staff.endDate}</span>
                </>
              )}
              {staff.daysPerWeek && (
                <>
                  <span className="text-gray-500">Days / Hours</span>
                  <span className="font-medium text-gray-800">{staff.daysPerWeek}</span>
                </>
              )}
              {staff.minHoursPerWeek && (
                <>
                  <span className="text-gray-500">Min hours/wk</span>
                  <span className="font-medium text-gray-800">{staff.minHoursPerWeek}</span>
                </>
              )}
              {staff.probationaryDate && (
                <>
                  <span className="text-gray-500">Probation end</span>
                  <span className="font-medium text-gray-800">
                    {new Date(staff.probationaryDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </>
              )}
              {staff.dob && (
                <>
                  <span className="text-gray-500">DOB</span>
                  <span className="font-medium text-gray-800">
                    {new Date(staff.dob).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </>
              )}
            </div>
          </section>

          {/* Contact */}
          {(staff.email || staff.mobile) && (
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Contact</h3>
              <div className="space-y-1.5">
                {staff.email && (
                  <a href={`mailto:${staff.email}`}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                    <span>✉️</span>{staff.email}
                  </a>
                )}
                {staff.mobile && (
                  <a href={`tel:0${staff.mobile}`}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                    <span>📱</span>0{staff.mobile}
                  </a>
                )}
              </div>
            </section>
          )}

          {/* Compliance */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Compliance</h3>
            <div className="bg-gray-50 rounded-xl px-3 py-1">
              {complianceItems.map(item => (
                <CompliancePill key={item.label} {...item} />
              ))}
            </div>
          </section>

          {/* Documents */}
          {allDocs.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                Documents ({allDocs.length})
              </h3>
              <div className="grid grid-cols-1 gap-1.5">
                {allDocs.map((doc, i) => (
                  <DocLink key={i} label={doc.label} url={doc.url} />
                ))}
              </div>
            </section>
          )}

          {/* Vacancy seek link */}
          {staff.seekUrl && (
            <section>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Vacancy</h3>
              <a href={staff.seekUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <span>🔗</span> Seek listing ↗
              </a>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Compliance alert counts ────────────────────────────────────────────────

function getComplianceAlerts(staff: StaffMember[]) {
  let expired = 0, warning = 0;
  const active = staff.filter(s => s.isActive);
  for (const s of active) {
    const dates = [
      s.compliance.wwccExpiry,
      s.compliance.firstAidExpiry,
      s.compliance.cprExpiry,
      s.compliance.anaphylaxisExpiry,
      s.compliance.childProtectionRenewal,
    ];
    for (const d of dates) {
      const days = daysUntil(d);
      if (days === null) continue;
      if (days < 0) expired++;
      else if (days <= 90) warning++;
    }
  }
  return { expired, warning };
}

// ── Main page ─────────────────────────────────────────────────────────────

type FilterType = 'all' | 'active' | 'casual' | 'trainees' | 'vacancies';

export default function StaffingStructurePage() {
  const user = getUser();

  // Centre selection
  const accessibleCentres = useMemo(() => {
    if (!user) return [];
    if (user.role === 'admin' || user.role === 'ceo') return CENTRES;
    if (user.role === 'area_manager') {
      // Area managers: same cluster logic — for now show all, can filter later
      return CENTRES;
    }
    return CENTRES.filter(c => c.id === user.centreId);
  }, [user]);

  const [selectedCentreId, setSelectedCentreId] = useState<string>('');
  useEffect(() => {
    if (accessibleCentres.length > 0 && !selectedCentreId) {
      setSelectedCentreId(accessibleCentres[0].id);
    }
  }, [accessibleCentres]);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterType>('active');
  const [search, setSearch] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [resignedOpen, setResignedOpen] = useState(false);

  useEffect(() => {
    if (!selectedCentreId) return;
    setLoading(true);
    setError(null);
    setStaff([]);
    fetch(`/api/staffing-structure?centreId=${selectedCentreId}`)
      .then(r => {
        if (!r.ok) return r.json().then(j => { throw new Error(j.error || r.statusText); });
        return r.json();
      })
      .then(data => {
        setStaff(data.staff || []);
        setFetchedAt(data.fetchedAt);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [selectedCentreId]);

  const alerts = useMemo(() => getComplianceAlerts(staff), [staff]);

  const filteredStaff = useMemo(() => {
    let s = staff.filter(m => !m.isResigned);
    if (filter === 'active')    s = s.filter(m => m.isActive && !m.isVacancy);
    if (filter === 'casual')    s = s.filter(m => m.positionCategory?.toLowerCase().includes('casual') || m.position?.toLowerCase().includes('casual'));
    if (filter === 'trainees')  s = s.filter(m => m.qualification === 'Trainee');
    if (filter === 'vacancies') s = staff.filter(m => m.isVacancy);
    if (search.trim()) {
      const q = search.toLowerCase();
      s = s.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.position?.toLowerCase().includes(q) ||
        m.qualification?.toLowerCase().includes(q)
      );
    }
    return s;
  }, [staff, filter, search]);

  const resignedStaff = useMemo(() =>
    staff.filter(m => m.isResigned || (m.endDate && m.endDate !== 'Not Applicable' && daysUntil(undefined) !== null)),
    [staff]
  );

  const centreName = CENTRES.find(c => c.id === selectedCentreId)?.name ?? '';

  // ── Render ─────────────────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Please log in to view staffing structure.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">👥 Staffing Structure</h1>
            {fetchedAt && (
              <p className="text-xs text-gray-400 mt-0.5">
                Live from Monday.com · updated {new Date(fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          {accessibleCentres.length > 1 && (
            <select
              value={selectedCentreId}
              onChange={e => setSelectedCentreId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {accessibleCentres.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">

        {/* Compliance alert banner */}
        {!loading && (alerts.expired > 0 || alerts.warning > 0) && (
          <div className="flex flex-wrap gap-3">
            {alerts.expired > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
                style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                🔴 {alerts.expired} expired compliance item{alerts.expired !== 1 ? 's' : ''}
              </div>
            )}
            {alerts.warning > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium"
                style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}>
                ⚠️ {alerts.warning} item{alerts.warning !== 1 ? 's' : ''} expiring within 90 days
              </div>
            )}
          </div>
        )}

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search by name, position..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {(['all', 'active', 'casual', 'trainees', 'vacancies'] as FilterType[]).map(f => (
            <button key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
              }`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-2xl p-10 text-center">
            <div className="text-3xl mb-2 animate-pulse">👥</div>
            <div className="text-gray-400 text-sm">Loading staffing structure for {centreName}…</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-red-700 text-sm">
            <strong>Failed to load:</strong> {error}
          </div>
        )}

        {/* Staff table */}
        {!loading && !error && (
          <>
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-700">
                  {filter === 'vacancies' ? 'Vacancies' :
                   filter === 'active' ? 'Active Staff' :
                   filter === 'casual' ? 'Casual Staff' :
                   filter === 'trainees' ? 'Trainees' : 'All Staff'}
                  <span className="ml-2 text-gray-400 font-normal">({filteredStaff.length})</span>
                </h2>
              </div>

              {filteredStaff.length === 0 ? (
                <div className="px-4 py-10 text-center text-gray-400 text-sm">
                  No staff matching current filter.
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {filteredStaff.map(s => {
                    const compDates = [
                      s.compliance.wwccExpiry,
                      s.compliance.firstAidExpiry,
                      s.compliance.cprExpiry,
                      s.compliance.anaphylaxisExpiry,
                    ];
                    const worstDays = compDates
                      .map(d => daysUntil(d))
                      .filter((d): d is number => d !== null)
                      .reduce((min, d) => Math.min(min, d), Infinity);
                    const rowAlert = worstDays < 0 ? 'expired'
                      : worstDays <= 90 ? 'warning' : 'ok';

                    return (
                      <button key={s.mondayId}
                        onClick={() => setSelectedStaff(s)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left group">
                        {/* Qual badge */}
                        <div className="flex-shrink-0 w-16 text-center">
                          {qualBadge(s.qualification)}
                        </div>
                        {/* Name + position */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate group-hover:text-blue-700">
                            {s.name}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {[s.position, s.positionCategory].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        {/* Start date */}
                        <div className="flex-shrink-0 text-xs text-gray-400 hidden sm:block">
                          {s.startDate
                            ? new Date(s.startDate).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
                            : '—'}
                        </div>
                        {/* Compliance dot */}
                        <div className="flex-shrink-0">
                          {rowAlert === 'expired' && <span className="text-sm">🔴</span>}
                          {rowAlert === 'warning' && <span className="text-sm">⚠️</span>}
                          {rowAlert === 'ok' && worstDays !== Infinity && <span className="text-sm text-green-500">✅</span>}
                        </div>
                        {/* Action badge */}
                        {s.action && (
                          <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                            {s.action}
                          </span>
                        )}
                        <span className="flex-shrink-0 text-gray-300 group-hover:text-blue-400">›</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Resigned / Historical — collapsed */}
            {resignedStaff.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button
                  onClick={() => setResignedOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                  <h2 className="text-sm font-bold text-gray-400">
                    Former Staff / Resigned
                    <span className="ml-2 font-normal">({resignedStaff.length})</span>
                  </h2>
                  <span className="text-gray-400 text-sm">{resignedOpen ? '▲' : '▼'}</span>
                </button>
                {resignedOpen && (
                  <div className="divide-y divide-gray-50 border-t border-gray-100">
                    {resignedStaff.map(s => (
                      <button key={s.mondayId}
                        onClick={() => setSelectedStaff(s)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group opacity-60">
                        <div className="flex-shrink-0 w-16 text-center">
                          {qualBadge(s.qualification)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-600 truncate">{s.name}</div>
                          <div className="text-xs text-gray-400 truncate">
                            {[s.position, s.endDate && s.endDate !== 'Not Applicable' ? `ended ${s.endDate}` : undefined].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <span className="flex-shrink-0 text-gray-200 group-hover:text-gray-400">›</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Staff card detail panel */}
      {selectedStaff && (
        <StaffCard staff={selectedStaff} onClose={() => setSelectedStaff(null)} />
      )}
    </div>
  );
}
