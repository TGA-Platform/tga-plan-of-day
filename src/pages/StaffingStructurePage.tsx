import { useState, useEffect, useMemo } from 'react';
import type { StaffMember } from '../types';
import { CENTRES } from '../config';
import { getUser } from '../auth';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface StaffGroup {
  id: string;
  title: string;
  color: string;
  isActive: boolean;
  staff: StaffMember[];
}

interface BoardData {
  centreId: string;
  boardId: number;
  groups: StaffGroup[];
  editableColumns: { id: string; label: string; type: string }[];
  fetchedAt: string;
}

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BRAND = {
  green:      '#2d5c18',
  greenLight: '#5a9228',
  bg:         '#F5FAF3',
  border:     '#E2F1DA',
  white:      '#ffffff',
  text:       '#050505',
  textMuted:  '#596570',
  divider:    '#D0E8B8',
};

const QUAL_META: Record<string, { bg: string; text: string; short: string }> = {
  'ECT':           { bg: '#dbeafe', text: '#1e40af', short: 'ECT' },
  'WT ECT':        { bg: '#ede9fe', text: '#5b21b6', short: 'WT ECT' },
  'Diploma':       { bg: '#dcfce7', text: '#166534', short: 'DIP' },
  'Certificate 3': { bg: '#fef9c3', text: '#854d0e', short: 'CERT3' },
  'Trainee':       { bg: '#ffedd5', text: '#9a3412', short: 'TRAINEE' },
  'ISS':           { bg: '#f3e8ff', text: '#7e22ce', short: 'ISS' },
  'Chef':          { bg: '#fce7f3', text: '#9d174d', short: 'CHEF' },
  'PPL':           { bg: '#e0f2fe', text: '#0369a1', short: 'PPL' },
  'Resigned':      { bg: '#f1f5f9', text: '#94a3b8', short: 'LEFT' },
};

const QUAL_OPTIONS = ['ECT', 'WT ECT', 'Diploma', 'Certificate 3', 'Trainee', 'ISS', 'Chef', 'PPL'];

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}

function complianceLevel(days: number | null): 'ok' | 'warning' | 'expired' | 'missing' {
  if (days === null) return 'missing';
  if (days < 0) return 'expired';
  if (days <= 90) return 'warning';
  return 'ok';
}

function worstCompliance(staff: StaffMember): 'ok' | 'warning' | 'expired' | 'missing' {
  const c = staff.compliance;
  const dates = [c.wwccExpiry, c.firstAidExpiry, c.cprExpiry, c.anaphylaxisExpiry, c.childProtectionRenewal];
  const levels: ('ok' | 'warning' | 'expired' | 'missing')[] = dates.map(d => complianceLevel(daysUntil(d)));
  if (levels.includes('expired')) return 'expired';
  if (levels.includes('warning')) return 'warning';
  if (levels.every(l => l === 'missing')) return 'missing';
  return 'ok';
}

function fmtDate(iso?: string) {
  if (!iso) return 'â€”';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function QualBadge({ qual }: { qual: string }) {
  const m = QUAL_META[qual] ?? { bg: '#f1f5f9', text: '#64748b', short: qual?.slice(0, 6) ?? '?' };
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-xs font-bold leading-tight"
      style={{ backgroundColor: m.bg, color: m.text }}>{m.short}</span>
  );
}

function ComplianceDot({ staff }: { staff: StaffMember }) {
  const level = worstCompliance(staff);
  if (level === 'expired') return <span title="Compliance expired">ðŸ”´</span>;
  if (level === 'warning')  return <span title="Compliance expiring soon">âš ï¸</span>;
  if (level === 'ok')       return <span title="Compliance ok" className="text-green-500">âœ…</span>;
  return null;
}

// â”€â”€ Document Preview Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DocPreviewModal({ doc, onClose }: { doc: { label: string; url: string }; onClose: () => void }) {
  const isPdf = doc.url.toLowerCase().includes('.pdf');
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.url);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ width: '90vw', maxWidth: 900, height: '90vh' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: BRAND.border }}>
          <span className="font-semibold text-sm" style={{ color: BRAND.text }}>ðŸ“„ {doc.label}</span>
          <div className="flex items-center gap-2">
            <a href={doc.url} target="_blank" rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg font-medium border hover:opacity-80 transition-opacity"
              style={{ borderColor: BRAND.border, color: BRAND.textMuted }}>
              Open in new tab â†—
            </a>
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">
              âœ•
            </button>
          </div>
        </div>
        {/* Preview */}
        <div className="flex-1 overflow-hidden rounded-b-2xl">
          {isPdf && (
            <iframe src={doc.url} className="w-full h-full border-0" title={doc.label} />
          )}
          {isImage && (
            <div className="w-full h-full flex items-center justify-center bg-gray-50 p-4">
              <img src={doc.url} alt={doc.label} className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
          )}
          {!isPdf && !isImage && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400">
              <span className="text-5xl">ðŸ“Ž</span>
              <p className="text-sm">Preview not available for this file type.</p>
              <a href={doc.url} target="_blank" rel="noopener noreferrer"
                className="text-sm px-4 py-2 rounded-xl font-medium text-white"
                style={{ backgroundColor: BRAND.green }}>
                Download / Open â†—
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Edit Staff Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EditStaffModal({
  staff, editableColumns, groups, onSave, onClose,
}: {
  staff: StaffMember;
  editableColumns: { id: string; label: string; type: string }[];
  groups: StaffGroup[];
  onSave: (updates: { columnId?: string; value?: string; groupId?: string; groupTitle?: string }[]) => Promise<void>;
  onClose: () => void;
}) {
  // Build initial form state from current staff values
  const initial: Record<string, string> = {
    dropdown: staff.position || '',
    text_mm2xj3x9: staff.positionCategory || '',
    date: staff.startDate || '',
    text9: staff.endDate || '',
    email20: staff.email || '',
    mobile20: staff.mobile || '',
    text: staff.daysPerWeek || '',
    'dup__of_days_per_week__1': staff.minHoursPerWeek || '',
    wwccnum20: staff.compliance.wwccNumber || '',
    wwccexp20: staff.compliance.wwccExpiry || '',
    first_aid_code: staff.compliance.firstAidCode || '',
    date92: staff.compliance.firstAidExpiry || '',
    cpr_code: staff.compliance.cprCode || '',
    'dup__of_cpr_code': staff.compliance.cprExpiry || '',
    anaphylaxis_code: staff.compliance.anaphylaxisCode || '',
    date35: staff.compliance.anaphylaxisExpiry || '',
    'date__1': staff.compliance.childProtectionRenewal || '',
  };

  const [form, setForm] = useState<Record<string, string>>(initial);
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeGroups = groups.filter(g => g.isActive);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updates: { columnId?: string; value?: string; groupId?: string; groupTitle?: string }[] = [];

      // Column updates â€” only changed values
      for (const col of editableColumns) {
        const newVal = (form[col.id] || '').trim();
        const oldVal = (initial[col.id] || '').trim();
        if (newVal !== oldVal) {
          updates.push({ columnId: col.id, value: newVal });
        }
      }

      // Group move
      if (targetGroupId) {
        const grp = groups.find(g => g.id === targetGroupId);
        updates.push({ groupId: targetGroupId, groupTitle: grp?.title });
      }

      await onSave(updates);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ width: '100%', maxWidth: 560, maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: BRAND.border }}>
          <div>
            <h2 className="font-bold text-base" style={{ color: BRAND.text }}>Edit Staff Profile</h2>
            <p className="text-xs mt-0.5" style={{ color: BRAND.textMuted }}>{staff.name}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">
            âœ•
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Move to room */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>
              Move to Room / Group
            </h3>
            <select value={targetGroupId} onChange={e => setTargetGroupId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: BRAND.border }}>
              <option value="">â€” Keep in current room â€”</option>
              {activeGroups.map(g => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </section>

          {/* Employment */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>
              Employment
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {editableColumns.filter(c => ['dropdown','text_mm2xj3x9','date','text9','text','dup__of_days_per_week__1'].includes(c.id)).map(col => (
                <div key={col.id} className={col.id === 'text' || col.id === 'dup__of_days_per_week__1' ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium mb-1" style={{ color: BRAND.textMuted }}>{col.label}</label>
                  <input type={col.type === 'date' ? 'date' : 'text'}
                    value={form[col.id] || ''}
                    onChange={e => setForm(f => ({ ...f, [col.id]: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                    style={{ borderColor: BRAND.border }} />
                </div>
              ))}
            </div>
          </section>

          {/* Contact */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>
              Contact
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {editableColumns.filter(c => ['email20','mobile20'].includes(c.id)).map(col => (
                <div key={col.id}>
                  <label className="block text-xs font-medium mb-1" style={{ color: BRAND.textMuted }}>{col.label}</label>
                  <input type="text"
                    value={form[col.id] || ''}
                    onChange={e => setForm(f => ({ ...f, [col.id]: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                    style={{ borderColor: BRAND.border }} />
                </div>
              ))}
            </div>
          </section>

          {/* Compliance */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>
              Compliance
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {editableColumns.filter(c => !['dropdown','text_mm2xj3x9','date','text9','text','dup__of_days_per_week__1','email20','mobile20'].includes(c.id)).map(col => (
                <div key={col.id}>
                  <label className="block text-xs font-medium mb-1" style={{ color: BRAND.textMuted }}>{col.label}</label>
                  <input type={col.type === 'date' ? 'date' : 'text'}
                    value={form[col.id] || ''}
                    onChange={e => setForm(f => ({ ...f, [col.id]: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                    style={{ borderColor: BRAND.border }} />
                </div>
              ))}
            </div>
          </section>

          {error && (
            <div className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: BRAND.border }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium border hover:opacity-80 transition-opacity"
            style={{ borderColor: BRAND.border, color: BRAND.textMuted }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ backgroundColor: saving ? '#9ca3af' : BRAND.green }}>
            {saving ? 'Savingâ€¦' : 'Save to Monday'}
          </button>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Staff Card (detail panel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StaffCard({
  staff, onEdit, onClose,
}: {
  staff: StaffMember;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [previewDoc, setPreviewDoc] = useState<{ label: string; url: string } | null>(null);
  const comp = staff.compliance;

  const compItems = [
    { label: 'WWCC',              expiry: comp.wwccExpiry,           code: comp.wwccNumber },
    { label: 'First Aid',         expiry: comp.firstAidExpiry,       code: comp.firstAidCode },
    { label: 'CPR',               expiry: comp.cprExpiry,            code: comp.cprCode },
    { label: 'Anaphylaxis',       expiry: comp.anaphylaxisExpiry,    code: comp.anaphylaxisCode },
    { label: 'Child Protection',  expiry: comp.childProtectionRenewal },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col"
          style={{ borderLeft: `1px solid ${BRAND.border}` }}
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="sticky top-0 z-10 bg-white px-5 pt-5 pb-4 border-b"
            style={{ borderColor: BRAND.border }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold leading-tight" style={{ color: BRAND.text }}>{staff.name}</h2>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <QualBadge qual={staff.qualification} />
                  {staff.position && (
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: BRAND.bg, color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}>
                      {staff.position}
                    </span>
                  )}
                  {staff.positionCategory && (
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }}>
                      {staff.positionCategory}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={onEdit}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: BRAND.green }}>
                  Edit
                </button>
                <button onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400">
                  âœ•
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 px-5 py-4 space-y-5">
            {/* Employment */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>Employment</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {staff.startDate && <><span style={{ color: BRAND.textMuted }}>Start</span><span className="font-medium">{fmtDate(staff.startDate)}</span></>}
                {staff.endDate && staff.endDate !== 'Not Applicable' && <><span style={{ color: BRAND.textMuted }}>End</span><span className="font-medium">{staff.endDate}</span></>}
                {staff.daysPerWeek && <><span style={{ color: BRAND.textMuted }}>Days/hours</span><span className="font-medium text-xs">{staff.daysPerWeek}</span></>}
                {staff.minHoursPerWeek && <><span style={{ color: BRAND.textMuted }}>Min hrs/wk</span><span className="font-medium">{staff.minHoursPerWeek}</span></>}
                {staff.probationaryDate && <><span style={{ color: BRAND.textMuted }}>Probation end</span><span className="font-medium">{fmtDate(staff.probationaryDate)}</span></>}
                {staff.dob && <><span style={{ color: BRAND.textMuted }}>DOB</span><span className="font-medium">{fmtDate(staff.dob)}</span></>}
                {staff.ratio50 && <><span style={{ color: BRAND.textMuted }}>50% ratio</span><span className="font-medium">{staff.ratio50}</span></>}
              </div>
            </section>

            {/* Contact */}
            {(staff.email || staff.mobile) && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>Contact</h3>
                <div className="space-y-1.5">
                  {staff.email && (
                    <a href={`mailto:${staff.email}`} className="flex items-center gap-2 text-sm hover:underline" style={{ color: BRAND.greenLight }}>
                      <span>âœ‰ï¸</span>{staff.email}
                    </a>
                  )}
                  {staff.mobile && (
                    <a href={`tel:0${staff.mobile}`} className="flex items-center gap-2 text-sm hover:underline" style={{ color: BRAND.greenLight }}>
                      <span>ðŸ“±</span>0{staff.mobile}
                    </a>
                  )}
                </div>
              </section>
            )}

            {/* Compliance */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>Compliance</h3>
              <div className="rounded-xl overflow-hidden border" style={{ borderColor: BRAND.border }}>
                {compItems.map((item, i) => {
                  const days = daysUntil(item.expiry);
                  const level = complianceLevel(days);
                  const icon = level === 'expired' ? 'ðŸ”´' : level === 'warning' ? 'âš ï¸' : level === 'ok' ? 'âœ…' : 'â€”';
                  const dateStr = item.expiry ? fmtDate(item.expiry) : null;
                  const dayStr = days !== null ? (days < 0 ? `Expired ${Math.abs(days)}d ago` : days <= 90 ? `${days}d remaining` : '') : '';
                  return (
                    <div key={item.label}
                      className={`flex items-start gap-3 px-3 py-2.5 text-sm ${i < compItems.length - 1 ? 'border-b' : ''}`}
                      style={{ borderColor: BRAND.border, backgroundColor: level === 'expired' ? '#fff5f5' : level === 'warning' ? '#fffbeb' : BRAND.white }}>
                      <span className="text-base w-5 flex-shrink-0 mt-0.5">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-xs" style={{ color: BRAND.text }}>{item.label}</div>
                        {item.code && <div className="text-xs" style={{ color: BRAND.textMuted }}>{item.code}</div>}
                        {dateStr && <div className="text-xs font-medium"
                          style={{ color: level === 'expired' ? '#991b1b' : level === 'warning' ? '#92400e' : BRAND.green }}>
                          {dateStr}{dayStr ? ` Â· ${dayStr}` : ''}
                        </div>}
                        {!dateStr && <div className="text-xs text-gray-400">Not recorded</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Documents */}
            {(staff.docs.length > 0 || staff.certDocs.length > 0) && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>
                  Documents ({staff.docs.length + staff.certDocs.length})
                </h3>
                <div className="grid grid-cols-1 gap-1.5">
                  {[...staff.docs, ...staff.certDocs].map((doc, i) => (
                    <button key={i}
                      onClick={() => setPreviewDoc(doc)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border text-left hover:opacity-80 transition-opacity group"
                      style={{ borderColor: BRAND.border, backgroundColor: BRAND.bg }}>
                      <span className="text-base">ðŸ“„</span>
                      <span className="flex-1 truncate" style={{ color: BRAND.text }}>{doc.label}</span>
                      <span className="text-xs" style={{ color: BRAND.textMuted }}>Preview â†—</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Action */}
            {staff.action && (
              <div className="px-3 py-2 rounded-xl text-sm font-semibold"
                style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                ðŸ”” {staff.action}
              </div>
            )}
          </div>
        </div>
      </div>

      {previewDoc && <DocPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />}
    </>
  );
}

// â”€â”€ Dashboard summary stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DashboardStats({ groups }: { groups: StaffGroup[] }) {
  const activeGroups = groups.filter(g => g.isActive);
  const allActive = activeGroups.flatMap(g => g.staff);

  const total = allActive.length;
  const byQual: Record<string, number> = {};
  for (const s of allActive) {
    const q = s.qualification || 'Unknown';
    byQual[q] = (byQual[q] || 0) + 1;
  }

  let expiredCount = 0, warningCount = 0;
  for (const s of allActive) {
    const level = worstCompliance(s);
    if (level === 'expired') expiredCount++;
    else if (level === 'warning') warningCount++;
  }

  // Count by group type
  const roomGroups = activeGroups.filter(g =>
    !/(float|internal casual|casual|hero|mat leave)/i.test(g.title));
  const floatCount = activeGroups.filter(g => /float/i.test(g.title)).flatMap(g => g.staff).length;
  const casualCount = activeGroups.filter(g => /casual/i.test(g.title)).flatMap(g => g.staff).length;
  const newCount = groups.filter(g => /^new$/i.test(g.title)).flatMap(g => g.staff).length;

  const statCard = (icon: string, value: string | number, label: string, bg: string, textCol: string) => (
    <div className="rounded-2xl p-4 flex flex-col gap-1" style={{ backgroundColor: bg }}>
      <div className="text-2xl">{icon}</div>
      <div className="text-2xl font-bold leading-tight" style={{ color: textCol }}>{value}</div>
      <div className="text-xs font-medium" style={{ color: textCol, opacity: 0.7 }}>{label}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCard('ðŸ‘¥', total, 'Active Staff', BRAND.white, BRAND.text)}
        {statCard('ðŸ ', roomGroups.length, 'Rooms', BRAND.bg, BRAND.green)}
        {statCard('ðŸ”´', expiredCount, 'Expired Compliance', expiredCount > 0 ? '#fee2e2' : BRAND.bg, expiredCount > 0 ? '#991b1b' : BRAND.textMuted)}
        {statCard('âš ï¸', warningCount, 'Expiring â‰¤90 Days', warningCount > 0 ? '#fef9c3' : BRAND.bg, warningCount > 0 ? '#92400e' : BRAND.textMuted)}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCard('ðŸŒŠ', floatCount, 'Float Staff', BRAND.bg, BRAND.text)}
        {statCard('ðŸ”„', casualCount, 'Internal Casuals', BRAND.bg, BRAND.text)}
        {statCard('ðŸ†•', newCount, 'New / Onboarding', BRAND.bg, BRAND.text)}
        <div className="rounded-2xl p-4" style={{ backgroundColor: BRAND.white }}>
          <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: BRAND.textMuted }}>Qualifications</div>
          <div className="space-y-1">
            {QUAL_OPTIONS.filter(q => byQual[q]).map(q => (
              <div key={q} className="flex items-center justify-between gap-2">
                <QualBadge qual={q} />
                <span className="text-sm font-bold" style={{ color: BRAND.text }}>{byQual[q]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Room Group Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RoomGroup({
  group, onSelect,
}: {
  group: StaffGroup;
  onSelect: (staff: StaffMember) => void;
}) {
  return (
    <div className="rounded-2xl overflow-hidden border" style={{ borderColor: BRAND.border, backgroundColor: BRAND.white }}>
      {/* Room header */}
      <div className="px-4 py-3 flex items-center gap-2"
        style={{ backgroundColor: group.color + '22', borderBottom: `1px solid ${BRAND.border}` }}>
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
        <h3 className="font-bold text-sm flex-1" style={{ color: BRAND.text }}>{group.title}</h3>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: BRAND.white, color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}>
          {group.staff.length}
        </span>
      </div>
      {/* Staff chips */}
      <div className="divide-y divide-gray-100">
        {group.staff.length === 0 ? (
          <div className="px-4 py-3 text-xs" style={{ color: BRAND.textMuted }}>No staff in this group.</div>
        ) : group.staff.map(s => (
          <button key={s.mondayId}
            onClick={() => onSelect(s)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:opacity-80 transition-opacity text-left group">
            <div className="flex-shrink-0"><QualBadge qual={s.qualification} /></div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate group-hover:underline" style={{ color: BRAND.text }}>{s.name}</div>
              {s.position && <div className="text-xs truncate" style={{ color: BRAND.textMuted }}>{s.position}</div>}
            </div>
            <ComplianceDot staff={s} />
            {s.action && (
              <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>!</span>
            )}
            <span className="flex-shrink-0 text-gray-300 group-hover:text-gray-500">â€º</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function StaffingStructurePage() {
  const user = getUser();

  const accessibleCentres = useMemo(() => {
    if (!user) return [];
    if (user.role === 'admin' || user.role === 'ceo') return CENTRES;
    if (user.role === 'area_manager') return CENTRES; // TODO: cluster filter
    return CENTRES.filter(c => c.id === user.centreId);
  }, [user]);

  const [centreId, setCentreId] = useState('');
  useEffect(() => {
    if (accessibleCentres.length > 0 && !centreId) setCentreId(accessibleCentres[0].id);
  }, [accessibleCentres]);

  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [qualFilter, setQualFilter] = useState<string>('all');
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showResigned, setShowResigned] = useState(false);

  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);

  function loadData(id: string) {
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/staffing-structure?centreId=${id}`)
      .then(r => r.ok ? r.json() : r.json().then(j => { throw new Error(j.error || r.statusText); }))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }

  useEffect(() => { if (centreId) loadData(centreId); }, [centreId]);

  async function handleSave(updates: { columnId?: string; value?: string; groupId?: string }[]) {
    if (!editingStaff || !data) return;
    for (const u of updates) {
      if (u.groupId) {
        await fetch(`/api/staffing-structure?centreId=${centreId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'move_item', itemId: editingStaff.mondayId, groupId: u.groupId }),
        });
      } else if (u.columnId) {
        await fetch(`/api/staffing-structure?centreId=${centreId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_item', itemId: editingStaff.mondayId, columnId: u.columnId, value: u.value }),
        });
      }
    }
    // Reload
    loadData(centreId);
  }

  const activeGroups = useMemo(() => data?.groups.filter(g => g.isActive) ?? [], [data]);
  const inactiveGroups = useMemo(() => data?.groups.filter(g => !g.isActive) ?? [], [data]);

  // Apply filters to each group's staff
  const filteredGroups = useMemo(() => {
    return activeGroups
      .filter(g => roomFilter === 'all' || g.id === roomFilter)
      .map(g => ({
        ...g,
        staff: g.staff.filter(s => {
          if (qualFilter !== 'all' && s.qualification !== qualFilter) return false;
          if (search.trim()) {
            const q = search.toLowerCase();
            if (!s.name.toLowerCase().includes(q) && !s.position?.toLowerCase().includes(q)) return false;
          }
          return true;
        }),
      }))
      .filter(g => g.staff.length > 0 || roomFilter === g.id); // keep selected room even if empty after filter
  }, [activeGroups, roomFilter, qualFilter, search]);

  const resignedGroup = useMemo(() =>
    inactiveGroups.find(g => /exited/i.test(g.title)), [inactiveGroups]);

  const centreName = CENTRES.find(c => c.id === centreId)?.name ?? '';

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: BRAND.bg }}>
      <p className="text-sm" style={{ color: BRAND.textMuted }}>Please log in to view staffing structure.</p>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ backgroundColor: BRAND.bg }}>
      {/* Header */}
      <div className="sticky top-0 z-40 px-4 py-3 border-b"
        style={{ backgroundColor: BRAND.white, borderColor: BRAND.border, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color: BRAND.text }}>ðŸ‘¥ Staffing Structure</h1>
            {data?.fetchedAt && (
              <p className="text-xs mt-0.5" style={{ color: BRAND.textMuted }}>
                Live from Monday.com Â· {new Date(data.fetchedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                {' Â· '}<button onClick={() => loadData(centreId)} className="underline hover:no-underline">Refresh</button>
              </p>
            )}
          </div>
          {accessibleCentres.length > 1 && (
            <select value={centreId} onChange={e => setCentreId(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2"
              style={{ borderColor: BRAND.border, backgroundColor: BRAND.white, color: BRAND.text }}>
              {accessibleCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5 space-y-5">

        {/* Loading */}
        {loading && (
          <div className="rounded-2xl p-10 text-center" style={{ backgroundColor: BRAND.white }}>
            <div className="text-3xl mb-2 animate-pulse">ðŸ‘¥</div>
            <div className="text-sm" style={{ color: BRAND.textMuted }}>Loading {centreName} staffing structureâ€¦</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-2xl p-5 text-sm border"
            style={{ backgroundColor: '#fff5f5', borderColor: '#fca5a5', color: '#991b1b' }}>
            <strong>Failed to load:</strong> {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* Dashboard */}
            <DashboardStats groups={data.groups} />

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <input type="text" placeholder="Search staffâ€¦" value={search}
                onChange={e => setSearch(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm flex-1 min-w-40 focus:outline-none focus:ring-2"
                style={{ borderColor: BRAND.border }} />

              {/* Room filter */}
              <select value={roomFilter} onChange={e => setRoomFilter(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: BRAND.border }}>
                <option value="all">All Rooms</option>
                {activeGroups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>

              {/* Qual filter */}
              <select value={qualFilter} onChange={e => setQualFilter(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: BRAND.border }}>
                <option value="all">All Qualifications</option>
                {QUAL_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>

            {/* Room groups grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGroups.map(g => (
                <RoomGroup key={g.id} group={g} onSelect={setSelectedStaff} />
              ))}
            </div>

            {/* Other inactive groups (On Hold / Offered / New) */}
            {inactiveGroups.filter(g => !(/exited/i.test(g.title))).some(g => g.staff.length > 0) && (
              <div className="rounded-2xl overflow-hidden border" style={{ borderColor: BRAND.border, backgroundColor: BRAND.white }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: BRAND.border }}>
                  <h3 className="font-bold text-sm" style={{ color: BRAND.textMuted }}>Pending / Onboarding</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {inactiveGroups.filter(g => !(/exited/i.test(g.title))).flatMap(g =>
                    g.staff.map(s => (
                      <button key={s.mondayId}
                        onClick={() => setSelectedStaff(s)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:opacity-80 transition-opacity text-left group">
                        <QualBadge qual={s.qualification} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate" style={{ color: BRAND.text }}>{s.name}</div>
                          <div className="text-xs" style={{ color: BRAND.textMuted }}>{s.position || 'â€”'}</div>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: BRAND.bg, color: BRAND.textMuted, border: `1px solid ${BRAND.border}` }}>
                          {inactiveGroups.find(g => g.staff.some(x => x.mondayId === s.mondayId))?.title}
                        </span>
                        <span style={{ color: BRAND.divider }}>â€º</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Exited Staff â€” collapsed */}
            {resignedGroup && resignedGroup.staff.length > 0 && (
              <div className="rounded-2xl overflow-hidden border" style={{ borderColor: BRAND.border, backgroundColor: BRAND.white }}>
                <button onClick={() => setShowResigned(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:opacity-80 transition-opacity">
                  <h3 className="text-sm font-bold" style={{ color: BRAND.textMuted }}>
                    Exited Staff <span className="font-normal">({resignedGroup.staff.length})</span>
                  </h3>
                  <span style={{ color: BRAND.textMuted }}>{showResigned ? 'â–²' : 'â–¼'}</span>
                </button>
                {showResigned && (
                  <div className="border-t divide-y" style={{ borderColor: BRAND.border }}>
                    {resignedGroup.staff.map(s => (
                      <button key={s.mondayId}
                        onClick={() => setSelectedStaff(s)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:opacity-80 transition-opacity text-left opacity-60">
                        <QualBadge qual={s.qualification} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" style={{ color: BRAND.textMuted }}>{s.name}</div>
                          <div className="text-xs" style={{ color: BRAND.textMuted }}>
                            {[s.position, s.endDate && s.endDate !== 'Not Applicable' ? `ended ${s.endDate}` : undefined].filter(Boolean).join(' Â· ')}
                          </div>
                        </div>
                        <span style={{ color: BRAND.divider }}>â€º</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Staff detail card */}
      {selectedStaff && (
        <StaffCard
          staff={selectedStaff}
          onEdit={() => { setEditingStaff(selectedStaff); setSelectedStaff(null); }}
          onClose={() => setSelectedStaff(null)}
        />
      )}

      {/* Edit modal */}
      {editingStaff && data && (
        <EditStaffModal
          staff={editingStaff}
          editableColumns={data.editableColumns}
          groups={data.groups}
          onSave={handleSave}
          onClose={() => setEditingStaff(null)}
        />
      )}
    </div>
  );
}

