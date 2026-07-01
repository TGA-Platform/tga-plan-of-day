import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
function safeFormat(d: Date | string | null | undefined, fmt: string): string {
  try {
    if (!d) return '--';
    const dt = d instanceof Date ? d : new Date(String(d));
    if (isNaN(dt.getTime())) return '--';
    return format(dt, fmt);
  } catch { return '--'; }
}
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { parseAgeMonths, calcRequiredStaff } from '../utils/ratioEngine';
import { withCache, bustCache } from '../utils/cache';
import { getUser, getAllowedCentres } from '../auth';

// All campuses tracked in Supabase (matches Owna centre names)
const ALL_CAMPUSES = [
  'Mount Annan', 'Spring Farm', 'Denham Court', 'Ed Park 1', 'Ed Park 2', 'Wilton',
  'Wollongong', 'Dapto 1', 'Dapto 2', 'North Wollongong', 'Shell Cove', 'South Nowra',
  'Bexley', 'Oatley', 'Belfield', 'Bankstown',
  'Glendale', 'Edgeworth', 'Aberglasslyn', 'Charlestown', 'Moorebank', 'Tuggerah', 'Bomaderry',
];

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

// --- Types -------------------------------------------------------------------

interface DeputyUnit {
  id: number;
  name: string;
  centre: string;
  type: 'room' | 'float' | 'leave' | 'support';
  ratio: number | null;
}

interface CentreSummary {
  campus: string;
  configuredCentreId?: string;
  childrenAttended: number;
  requiredStaff: number;
  staffRostered: number;
  floatsRostered: number;
  supportRostered: number;
  roomsAtRisk: number;
  overallStatus: 'green' | 'red' | 'unknown';
  deputyConfigured: boolean;
}

// --- Helpers -----------------------------------------------------------------

function StatusBadge({ status }: { status: CentreSummary['overallStatus'] }) {
  if (status === 'green')   return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}>✅ Compliant</span>;
  if (status === 'red')     return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>⚠️ At Risk</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}>– No data</span>;
}

function Num({ n, danger }: { n: number; danger?: boolean }) {
  return (
    <span className="text-base font-bold" style={{ color: danger && n > 0 ? '#dc2626' : '#A0D083' }}>
      {n}
    </span>
  );
}

// --- Main --------------------------------------------------------------------

export default function RatioSummaryPage() {
  const navigate = useNavigate();
  const user = getUser();
  const allowedCentres = user ? getAllowedCentres(user) : CENTRES;
  // Owna campus names for the allowed centres
  const allowedCampuses = allowedCentres.map(c => c.ownaName ?? c.name);
  const visibleCampuses = ALL_CAMPUSES.filter(c => allowedCampuses.includes(c));

  const [date, setDate]           = useState(todayStr());
  const [summaries, setSummaries] = useState<CentreSummary[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch all attendance + all Deputy units in parallel (cached 5 min)
      const [attRes, unitsRes] = await Promise.all([
        withCache(`summary-att:${date}`, () =>
          fetch(`/api/attendance?date=${date}`).then(r => r.json())
        ) as Promise<{ campus: string; child_name: string; room: string; sign_in: string | null; sign_out: string | null; age: string | null; ageMonths?: number | null; dob?: string | null; }[]>,
        withCache('deputy-units', () =>
          fetch('/api/deputy-units').then(r => r.json())
        , 10 * 60 * 1000) as Promise<DeputyUnit[]>,  // units rarely change — 10 min TTL
      ]);

      // 2. Batch-fetch ALL rosters (cached 5 min)
      const allRoomAndFloatIds = unitsRes
        .filter(u => u.type === 'room' || u.type === 'float' || u.type === 'support')
        .map(u => u.id);

      let allRosters: { employeeId: number; unitId: number }[] = [];
      if (allRoomAndFloatIds.length > 0) {
        const rosterRes = await withCache(`summary-rosters:${date}`, () =>
          fetch('/api/deputy-rosters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, unitIds: allRoomAndFloatIds }),
          }).then(r => r.json())
        );
        if (Array.isArray(rosterRes)) {
          allRosters = (rosterRes as { Employee: number; OperationalUnit: number }[]).map(r => ({
            employeeId: r.Employee,
            unitId: r.OperationalUnit,
          }));
        }
      }

      // Group Deputy units by centre name
      const unitsByCentre = new Map<string, DeputyUnit[]>();
      for (const u of unitsRes) {
        const list = unitsByCentre.get(u.centre) ?? [];
        list.push(u);
        unitsByCentre.set(u.centre, list);
      }

      // 3. Build summary per campus
      const result: CentreSummary[] = [];

      for (const campus of visibleCampuses) {
        const campusRows = attRes.filter(r => r.campus === campus);
        const attended = campusRows.filter(r => r.sign_in).length;

        // Map children for ratio calc
        const children = campusRows
          .filter(r => r.sign_in) // all who attended
          .map(r => ({ room: r.room, ageMonths: r.ageMonths ?? parseAgeMonths(r.age) }));

        // Match campus to configured centre (supports ownaName override e.g. Ed Park 1 ? Edmondson Park 1)
        const configCentre = CENTRES.find(c =>
          (c.ownaName ?? c.name).toLowerCase() === campus.toLowerCase() ||
          c.name.toLowerCase() === campus.toLowerCase()
        );

        // Match Deputy centre name ? may have slight naming differences
        // Also try matching via config full name (e.g. Deputy = "Edmondson Park 1", Owna = "Ed Park 1")
        const configFullName = configCentre?.name.toLowerCase();
        const deputyCentreName = [...unitsByCentre.keys()].find(k => {
          const kl = k.toLowerCase();
          const cl = campus.toLowerCase();
          return kl === cl ||
            kl.replace(/\s+/g, '') === cl.replace(/\s+/g, '') ||
            kl.includes(cl) || cl.includes(kl) ||
            (configFullName && (
              kl === configFullName ||
              kl.replace(/\s+/g, '') === configFullName.replace(/\s+/g, '') ||
              kl.includes(configFullName) || configFullName.includes(kl)
            ));
        });

        const centreUnits  = deputyCentreName ? (unitsByCentre.get(deputyCentreName) ?? []) : [];
        const floatUnits   = centreUnits.filter(u => u.type === 'float');
        const supportUnits = centreUnits.filter(u => u.type === 'support');
        const deputyConfigured = centreUnits.length > 0;

        // Use config unit IDs when available — avoids misclassification for centres with
        // friendly-named Deputy units (e.g. NW uses 'Explorers' not ''0-1 Room', so
        // classifyUnit() marks them as 'support' instead of 'room', giving staffRostered=0)
        const configRoomUnitIds  = configCentre
          ? new Set(configCentre.rooms.map(r => r.deputyUnitId))
          : new Set(centreUnits.filter(u => u.type === 'room').map(u => u.id));
        const configFloatUnitIds = configCentre?.floatUnitIds
          ? new Set(configCentre.floatUnitIds)
          : new Set(floatUnits.map(u => u.id));

        const allCentreUnitIds = new Set(centreUnits.map(u => u.id));
        // Merge config IDs so we fetch rosters for them even if classification differs
        const fetchUnitIds = new Set([...allCentreUnitIds, ...configRoomUnitIds, ...configFloatUnitIds]);

        const centreRosters = allRosters.filter(r => fetchUnitIds.has(r.unitId));

        // Deduplicate staff per category by employeeId
        const staffIds   = new Set(centreRosters.filter(r => configRoomUnitIds.has(r.unitId)).map(r => r.employeeId));
        const floatIds   = new Set(centreRosters.filter(r => configFloatUnitIds.has(r.unitId)).map(r => r.employeeId));
        const supportIds = new Set(centreRosters.filter(r => new Set(supportUnits.map(u => u.id)).has(r.unitId)).map(r => r.employeeId));

        // Required staff — use config ownaRoomName when available (same logic as detail page)
        // This avoids bad Deputy-unit-name matching for centres with friendly room names
        let requiredStaff = 0;
        if (configCentre && configCentre.rooms.length > 0) {
          // Use config rooms with correct ownaRoomName — identical to buildRoomStatus
          for (const room of configCentre.rooms) {
            const owna = (room.ownaRoomName ?? room.name).toLowerCase();
            const roomKids = children.filter(c => c.room.toLowerCase().includes(owna));
            const { required } = calcRequiredStaff(roomKids.map(k => ({ ageMonths: k.ageMonths } as any)));
            requiredStaff += required;
          }
        } else if (centreUnits.filter((u: DeputyUnit) => u.type === 'room').length > 0) {
          const roomUnits = centreUnits.filter((u: DeputyUnit) => u.type === 'room');
          // Fallback: match via Deputy unit name prefix (for unconfigured centres)
          const roomGroups = new Map<string, typeof children>();
          for (const child of children) {
            const matchedUnit = roomUnits.find(u => {
              const un = u.name.toLowerCase();
              const cn = child.room.toLowerCase();
              const prefix = un.match(/^[\d.]+[-–][\d.]+/)?.[0];
              return prefix ? cn.startsWith(prefix) || un.includes(cn.split(' ')[0]) : un.includes(cn) || cn.includes(un);
            });
            const key = matchedUnit?.name ?? child.room;
            const list = roomGroups.get(key) ?? [];
            list.push(child);
            roomGroups.set(key, list);
          }
          for (const [, kids] of roomGroups) {
            const { required } = calcRequiredStaff(kids.map(k => ({ ageMonths: k.ageMonths } as any)));
            requiredStaff += required;
          }
        } else {
          // No Deputy config — estimate from total children using a blended ratio
          requiredStaff = attended > 0 ? Math.ceil(attended / 7) : 0;
        }

        const shortage = requiredStaff - staffIds.size - floatIds.size;
        const overallStatus: CentreSummary['overallStatus'] = attended === 0
          ? 'unknown'
          : !deputyConfigured
          ? 'unknown'
          : shortage > 0 ? 'red' : 'green';

        result.push({
          campus,
          configuredCentreId: configCentre?.id,
          childrenAttended:   attended,
          requiredStaff,
          staffRostered:      staffIds.size,
          floatsRostered:     floatIds.size,
          supportRostered:    supportIds.size,
          roomsAtRisk:        shortage > 0 ? 1 : 0,
          overallStatus,
          deputyConfigured,
        });
      }

      // Sort: at-risk first, then by attendance desc
      result.sort((a, b) => {
        if (a.overallStatus === 'red' && b.overallStatus !== 'red') return -1;
        if (b.overallStatus === 'red' && a.overallStatus !== 'red') return 1;
        return b.childrenAttended - a.childrenAttended;
      });

      setSummaries(result);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  // Casuals needed per centre: same logic as Float Pool section in detail view
  function centreCasuals(s: CentreSummary): number {
    if (!s.deputyConfigured || s.childrenAttended === 0) return 0;
    const netShortfall   = Math.max(0, s.requiredStaff - s.staffRostered);
    const bufferRequired = s.staffRostered > 0 ? s.staffRostered / 6 : 0;
    const supportOffset  = s.childrenAttended < 100 ? 1 : 0;
    const floatersNeeded = Math.max(0, netShortfall + bufferRequired - supportOffset);
    return Math.max(0, floatersNeeded - s.floatsRostered);
  }
  function fmtFTE(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  const totalAttended  = summaries.reduce((s, c) => s + c.childrenAttended, 0);
  const totalRequired  = summaries.reduce((s, c) => s + c.requiredStaff, 0);
  const totalStaff     = summaries.reduce((s, c) => s + c.staffRostered, 0);
  const totalFloats    = summaries.reduce((s, c) => s + c.floatsRostered, 0);
  const totalSupport   = summaries.reduce((s, c) => s + c.supportRostered, 0);
  const totalAtRisk    = summaries.filter(c => c.overallStatus === 'red').length;
  const totalCasuals   = summaries.reduce((sum, c) => sum + centreCasuals(c), 0);

  return (
    <Layout>
      {/* -- Header -- */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight" style={{ color: '#2d5c18' }}>All Centres — Ratio Summary</h1>
          <p className="text-sm mt-0.5" style={{ color: '#596570' }}>
            {safeFormat(new Date(date + 'T00:00:00'), 'EEEE d MMMM yyyy')} — Attended today
          </p>
          {lastUpdated && (
            <p className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>Last updated {format(lastUpdated, 'h:mm:ss a')}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/ratio')} className="border rounded-xl px-4 py-2 text-sm font-semibold" style={{ borderColor: '#c0d0c0', color: '#5a9228' }}>
            Centre Detail
          </button>
          {user?.role === 'ceo' && (
            <button onClick={() => navigate('/settings')} className="border rounded-xl px-4 py-2 text-sm font-semibold" style={{ borderColor: '#c0d0c0', color: '#6b7280' }}>
              ⚙️ Settings
            </button>
          )}
          <input
            type="date" value={date}
            onChange={e => setDate(e.target.value)}
            className="border rounded-xl px-3 py-2 text-sm font-medium"
            style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
          />
          <button onClick={() => { bustCache(`summary-att:${date}`); bustCache(`summary-rosters:${date}`); load(); }} disabled={loading} className="border rounded-xl px-4 py-2 text-sm font-semibold" style={{ borderColor: '#c0d0c0', color: '#2d5c18', opacity: loading ? 0.5 : 1 }}>
            {loading ? '⏳ Loading…' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* -- Summary bar -- */}
      <div className="rounded-2xl p-5 mb-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" style={{ backgroundColor: '#2d5c18' }}>
        {[
          { icon: '👶', label: 'Children', value: totalAttended },
          { icon: '📋', label: 'Required Staff', value: totalRequired },
          { icon: '👥', label: 'Room Staff', value: totalStaff },
          { icon: '🌊', label: 'Floats', value: totalFloats },
          { icon: '💼', label: 'Support', value: totalSupport },
          { icon: '⚠️', label: 'Centres at Risk', value: totalAtRisk, danger: true },
          { icon: '📅', label: 'Casuals Needed', value: totalCasuals, danger: true },
        ].map(({ icon, label, value, danger }) => (
          <div key={label} className="rounded-xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-xl mb-1">{icon}</div>
            <div className="text-2xl font-bold" style={{ color: danger && (value as number) > 0 ? '#fca5a5' : 'white' }}>
              {loading ? '⏳' : value}
            </div>
            <div className="text-xs" style={{ color: '#E2F1DA' }}>{label}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-xl p-4 mb-6 text-sm" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>{error}</div>
      )}

      {/* -- Table -- */}
      <div className="rounded-2xl border overflow-hidden shadow-sm" style={{ borderColor: '#e0e8e0' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr style={{ backgroundColor: '#F5FAF3' }}>
                {['Centre', 'Attended', 'Required Staff', 'Room Staff', 'Floats', 'Support', 'Casuals', 'Status'].map(h => (
                  <th key={h} className="py-3 px-4 text-xs font-semibold uppercase tracking-wide text-center first:text-left" style={{ color: '#5a9228' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: '#E2F1DA' }}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="py-3 px-4"><div className="h-4 bg-gray-200 rounded w-3/4 mx-auto" /></td>
                    ))}
                  </tr>
                ))
              ) : summaries.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-sm italic" style={{ color: '#9ca3af' }}>No data for this date</td></tr>
              ) : (
                summaries.map(s => {
                  const canDrillIn = !!s.configuredCentreId;
                  const surplus    = (s.staffRostered + s.floatsRostered) - s.requiredStaff;
                  return (
                    <tr
                      key={s.campus}
                      className={`border-b transition-colors ${canDrillIn ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                      style={{ borderColor: '#E2F1DA' }}
                      onClick={() => {
                    if (s.configuredCentreId) navigate(`/ratio?centre=${s.configuredCentreId}`);
                    else if (s.childrenAttended > 0) navigate(`/ratio?campus=${encodeURIComponent(s.campus)}`);
                  }}
                    >
                      {/* Centre */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-sm" style={{ color: '#2d5c18' }}>{s.campus}</div>
                        {!s.deputyConfigured && s.childrenAttended > 0 && (
                          <div className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>Staff data pending</div>
                        )}
                      </td>
                      {/* Children attended */}
                      <td className="py-3 px-4 text-center"><Num n={s.childrenAttended} /></td>
                      {/* Required */}
                      <td className="py-3 px-4 text-center">
                        {s.childrenAttended > 0 ? <Num n={s.requiredStaff} /> : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      {/* Room staff */}
                      <td className="py-3 px-4 text-center">
                        {s.deputyConfigured
                          ? <span className="text-base font-bold" style={{ color: s.staffRostered < s.requiredStaff ? '#dc2626' : '#A0D083' }}>{s.staffRostered}</span>
                          : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      {/* Floats */}
                      <td className="py-3 px-4 text-center">
                        {s.deputyConfigured ? <Num n={s.floatsRostered} /> : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      {/* Support */}
                      <td className="py-3 px-4 text-center">
                        {s.deputyConfigured ? <Num n={s.supportRostered} /> : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      {/* Casuals */}
                      <td className="py-3 px-4 text-center">
                        {(() => {
                          const cas = centreCasuals(s);
                          if (!s.deputyConfigured || s.childrenAttended === 0)
                            return <span style={{ color: '#9ca3af' }}>—</span>;
                          if (cas <= 0)
                            return <span className="text-sm font-semibold" style={{ color: '#16a34a' }}>✅</span>;
                          return (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                              style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}
                            >
                              ⚠️ {fmtFTE(cas)} FTE
                            </span>
                          );
                        })()}
                      </td>
                      {/* Status */}
                      <td className="py-3 px-4 text-center">
                        {s.overallStatus !== 'unknown' && surplus !== 0 && s.childrenAttended > 0 && (
                          <div className="text-xs mb-1" style={{ color: surplus > 0 ? '#16a34a' : '#dc2626' }}>
                            {surplus > 0 ? `+${surplus} surplus` : `${surplus} short`}
                          </div>
                        )}
                        <StatusBadge status={s.overallStatus} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Totals row */}
            {!loading && summaries.length > 0 && (
              <tfoot>
                <tr style={{ backgroundColor: '#F5FAF3', borderTop: '2px solid #c6e0c6' }}>
                  <td className="py-3 px-4 text-xs font-bold uppercase" style={{ color: '#5a9228' }}>Total</td>
                  <td className="py-3 px-4 text-center font-bold" style={{ color: '#2d5c18' }}>{totalAttended}</td>
                  <td className="py-3 px-4 text-center font-bold" style={{ color: '#2d5c18' }}>{totalRequired}</td>
                  <td className="py-3 px-4 text-center font-bold" style={{ color: '#2d5c18' }}>{totalStaff}</td>
                  <td className="py-3 px-4 text-center font-bold" style={{ color: '#2d5c18' }}>{totalFloats}</td>
                  <td className="py-3 px-4 text-center font-bold" style={{ color: '#2d5c18' }}>{totalSupport}</td>
                  <td className="py-3 px-4 text-center">
                    {totalAtRisk > 0
                      ? <span className="text-xs font-semibold" style={{ color: '#dc2626' }}>{totalAtRisk} at risk</span>
                      : <span className="text-xs font-semibold" style={{ color: '#16a34a' }}>All OK</span>}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <p className="text-xs mt-3 text-center" style={{ color: '#9ca3af' }}>
        Click any row to drill into that centre — Auto-refreshes every 5 min — Based on children who attended (signed in)
      </p>
    </Layout>
  );
}
