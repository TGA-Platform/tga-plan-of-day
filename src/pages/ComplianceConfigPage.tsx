/**
 * Compliance Configuration Page
 * Admin-only page to configure which documents/certifications are required for each position
 */

import { useState, useMemo } from 'react';
import {
  ShieldCheck, Plus, Trash2, Save, X, ChevronDown, ChevronRight,
  CheckCircle, FileText, Award, Stethoscope
} from 'lucide-react';
import Layout from '../components/Layout';
import { getUser } from '../auth';
import { COMPLIANCE_REQUIREMENTS, type ComplianceRequirement } from '../compliance-requirements';

// All known positions across TGA
const ALL_POSITIONS = [
  'Centre Director',
  'Assistant Director',
  'Educational Leader',
  'Room Leader',
  'Early Childhood Teacher',
  'Educator',
  'Educator Casual',
  'Float',
  'Internal Casual',
  'Trainee',
  'Childcare Trainee',
  'Diploma Educator',
  'Centre Support',
  'Chef',
  'ISS Support Worker',
];

// Categories with icons
const CATEGORY_CONFIG = {
  certification: { label: 'Certifications', icon: Award, color: '#2d5c18' },
  document: { label: 'Documents', icon: FileText, color: '#2563eb' },
  check: { label: 'Checks', icon: ShieldCheck, color: '#d97706' },
};

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const el = document.createElement('div');
  el.className = `fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all`;
  el.style.backgroundColor = type === 'success' ? '#e8f5e0' : '#fff5f5';
  el.style.color = type === 'success' ? '#2d5c18' : '#dc2626';
  el.style.border = `1px solid ${type === 'success' ? '#D0E8B8' : '#fecaca'}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

export default function ComplianceConfigPage() {
  const user = getUser();
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([...COMPLIANCE_REQUIREMENTS]);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [editingReq, setEditingReq] = useState<ComplianceRequirement | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['certification', 'document', 'check']));
  // Future: search functionality
  // const [searchPosition, setSearchPosition] = useState('');

  // Filter requirements by selected positions
  const filteredRequirements = useMemo(() => {
    if (selectedPositions.length === 0) return requirements;
    return requirements.filter(req =>
      req.requiredFor.some(pos => selectedPositions.includes(pos))
    );
  }, [requirements, selectedPositions]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, ComplianceRequirement[]> = {};
    filteredRequirements.forEach(req => {
      if (!groups[req.category]) groups[req.category] = [];
      groups[req.category].push(req);
    });
    return groups;
  }, [filteredRequirements]);

  const togglePosition = (pos: string) => {
    setSelectedPositions(prev =>
      prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]
    );
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleSave = () => {
    // In a real implementation, this would save to an API/Supabase
    // For now, we'll save to localStorage as a demo
    localStorage.setItem('compliance_requirements', JSON.stringify(requirements));
    showToast('Requirements saved successfully');
  };

  const handleDelete = (id: string) => {
    if (!confirm('Are you sure you want to delete this requirement?')) return;
    setRequirements(prev => prev.filter(r => r.id !== id));
    showToast('Requirement deleted');
  };

  const handleUpdate = (updated: ComplianceRequirement) => {
    setRequirements(prev => prev.map(r => r.id === updated.id ? updated : r));
    setEditingReq(null);
    showToast('Requirement updated');
  };

  const handleCreate = (newReq: ComplianceRequirement) => {
    setRequirements(prev => [...prev, newReq]);
    setIsCreating(false);
    showToast('Requirement created');
  };

  if (!user) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-gray-500">Please log in.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 pb-10" style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: '#050505' }}>
              <ShieldCheck size={22} style={{ color: '#2d5c18' }} />
              Compliance Configuration
            </h1>
            <p className="text-sm mt-1" style={{ color: '#596570' }}>
              Configure which documents and certifications are required for each position
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg"
              style={{ backgroundColor: '#2d5c18', color: '#fff' }}
            >
              <Plus size={14} />
              Add Requirement
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg"
              style={{ backgroundColor: '#e8f5e0', color: '#2d5c18', border: '1px solid #D0E8B8' }}
            >
              <Save size={14} />
              Save Changes
            </button>
          </div>
        </div>

        {/* Position Filter */}
        <div className="rounded-xl p-4" style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA' }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#596570' }}>
            Filter by Position
          </h3>
          <div className="flex flex-wrap gap-2">
            {ALL_POSITIONS.map(pos => (
              <button
                key={pos}
                onClick={() => togglePosition(pos)}
                className="text-xs px-3 py-1.5 rounded-full transition-all"
                style={{
                  backgroundColor: selectedPositions.includes(pos) ? '#e8f5e0' : '#F5FAF3',
                  color: selectedPositions.includes(pos) ? '#2d5c18' : '#596570',
                  border: `1px solid ${selectedPositions.includes(pos) ? '#D0E8B8' : '#E2F1DA'}`,
                }}
              >
                {pos}
              </button>
            ))}
          </div>
          {selectedPositions.length > 0 && (
            <button
              onClick={() => setSelectedPositions([])}
              className="text-xs mt-2"
              style={{ color: '#596570' }}
            >
              Clear filter
            </button>
          )}
        </div>

        {/* Requirements by Category */}
        <div className="space-y-4">
          {Object.entries(CATEGORY_CONFIG).map(([cat, config]) => {
            const items = grouped[cat] || [];
            const Icon = config.icon;
            const isExpanded = expandedCategories.has(cat);

            return (
              <div key={cat} className="rounded-xl overflow-hidden" style={{ backgroundColor: '#ffffff', border: '1px solid #E2F1DA' }}>
                <button
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center justify-between px-5 py-3"
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} style={{ color: config.color }} />
                    <span className="text-sm font-semibold" style={{ color: '#050505' }}>{config.label}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F5FAF3', color: '#596570' }}>
                      {items.length}
                    </span>
                  </div>
                  {isExpanded ? <ChevronDown size={16} style={{ color: '#596570' }} /> : <ChevronRight size={16} style={{ color: '#596570' }} />}
                </button>

                {isExpanded && (
                  <div className="px-5 pb-4">
                    {items.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2">No requirements for selected positions</p>
                    ) : (
                      <div className="space-y-2">
                        {items.map(req => (
                          <div
                            key={req.id}
                            className="flex items-start gap-3 p-3 rounded-lg"
                            style={{ backgroundColor: '#F5FAF3' }}
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium" style={{ color: '#050505' }}>{req.label}</span>
                                {req.isMandatory ? (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>Required</span>
                                ) : (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>Optional</span>
                                )}
                              </div>
                              {req.description && (
                                <p className="text-xs mt-1" style={{ color: '#596570' }}>{req.description}</p>
                              )}
                              <div className="flex flex-wrap gap-1 mt-2">
                                {req.requiredFor.map(pos => (
                                  <span
                                    key={pos}
                                    className="text-xs px-2 py-0.5 rounded-full"
                                    style={{ backgroundColor: '#ffffff', color: '#596570', border: '1px solid #E2F1DA' }}
                                  >
                                    {pos}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <button
                                onClick={() => setEditingReq(req)}
                                className="p-1.5 rounded-lg hover:bg-white"
                                title="Edit"
                              >
                                <Stethoscope size={13} style={{ color: '#596570' }} />
                              </button>
                              <button
                                onClick={() => handleDelete(req.id)}
                                className="p-1.5 rounded-lg hover:bg-white"
                                title="Delete"
                              >
                                <Trash2 size={13} style={{ color: '#dc2626' }} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Modal */}
      {editingReq && (
        <RequirementModal
          requirement={editingReq}
          allPositions={ALL_POSITIONS}
          onSave={handleUpdate}
          onClose={() => setEditingReq(null)}
        />
      )}

      {/* Create Modal */}
      {isCreating && (
        <RequirementModal
          allPositions={ALL_POSITIONS}
          onSave={handleCreate}
          onClose={() => setIsCreating(false)}
        />
      )}
    </Layout>
  );
}

// ── Requirement Modal ──────────────────────────────────────────────────────

function RequirementModal({
  requirement,
  allPositions,
  onSave,
  onClose,
}: {
  requirement?: ComplianceRequirement;
  allPositions: string[];
  onSave: (req: ComplianceRequirement) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(requirement?.label || '');
  const [category, setCategory] = useState<ComplianceRequirement['category']>(requirement?.category || 'certification');
  const [selectedPositions, setSelectedPositions] = useState<string[]>(requirement?.requiredFor || []);
  const [isMandatory, setIsMandatory] = useState(requirement?.isMandatory ?? true);
  const [description, setDescription] = useState(requirement?.description || '');
  const [expiryField, setExpiryField] = useState(requirement?.expiryField || '');

  const handleSubmit = () => {
    if (!label.trim()) { showToast('Label is required', 'error'); return; }
    if (selectedPositions.length === 0) { showToast('Select at least one position', 'error'); return; }

    const req: ComplianceRequirement = {
      id: requirement?.id || `req_${Date.now()}`,
      label: label.trim(),
      category,
      requiredFor: selectedPositions,
      isMandatory,
      description: description.trim() || undefined,
      expiryField: expiryField.trim() || undefined,
    };

    onSave(req);
  };

  const togglePosition = (pos: string) => {
    setSelectedPositions(prev =>
      prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-[600px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-2xl p-6"
        style={{ backgroundColor: '#ffffff', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold" style={{ color: '#050505' }}>
            {requirement ? 'Edit Requirement' : 'Add Requirement'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X size={18} style={{ color: '#596570' }} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>Label *</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Working with Children Check"
              className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
              style={{ border: '1px solid #E2F1DA' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>Category *</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as ComplianceRequirement['category'])}
              className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
              style={{ border: '1px solid #E2F1DA' }}
            >
              <option value="certification">Certification</option>
              <option value="document">Document</option>
              <option value="check">Check</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of this requirement"
              className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
              style={{ border: '1px solid #E2F1DA' }}
            />
          </div>

          {category === 'certification' && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#596570' }}>Expiry Field (optional)</label>
              <input
                type="text"
                value={expiryField}
                onChange={e => setExpiryField(e.target.value)}
                placeholder="e.g. wwcc_expiry, first_aid_expiry"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                style={{ border: '1px solid #E2F1DA' }}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: '#596570' }}>
              Required For * <span className="text-gray-400">({selectedPositions.length} selected)</span>
            </label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 rounded-lg" style={{ border: '1px solid #E2F1DA' }}>
              {allPositions.map(pos => (
                <button
                  key={pos}
                  onClick={() => togglePosition(pos)}
                  className="text-xs px-3 py-1.5 rounded-full transition-all"
                  style={{
                    backgroundColor: selectedPositions.includes(pos) ? '#e8f5e0' : '#F5FAF3',
                    color: selectedPositions.includes(pos) ? '#2d5c18' : '#596570',
                    border: `1px solid ${selectedPositions.includes(pos) ? '#D0E8B8' : '#E2F1DA'}`,
                  }}
                >
                  {selectedPositions.includes(pos) && <CheckCircle size={10} className="inline mr-1" />}
                  {pos}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mandatory"
              checked={isMandatory}
              onChange={e => setIsMandatory(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="mandatory" className="text-sm" style={{ color: '#050505' }}>
              Mandatory requirement
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: '#596570' }}>Cancel</button>
            <button
              onClick={handleSubmit}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg"
              style={{ backgroundColor: '#2d5c18', color: '#fff' }}
            >
              <Save size={14} />
              {requirement ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
