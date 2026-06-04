import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { CENTRES } from '../config';
import { STAFFING_RULES, RULE_CATEGORIES } from '../data/staffingRules';
import {
  getRuleSets,
  getCentreConfigs,
  setCentreRuleSet,
  upsertRuleSet,
  deleteRuleSet,
  generateId,
  DEFAULT_RULE_SET,
  DEFAULT_ROLE_KEYWORDS,
} from '../utils/centreConfigStorage';
import type { RuleSet, RoleKeywords } from '../types/config';

// ── Helpers ──────────────────────────────────────────────────────────────────

function tagListToArray(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function arrayToTagList(arr: string[]): string {
  return arr.join(', ');
}

// ── Rule toggle component ────────────────────────────────────────────────────

function RuleToggle({
  rule,
  enabled,
  onChange,
}: {
  rule: (typeof STAFFING_RULES)[0];
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="flex-shrink-0 mt-0.5">
        <div
          onClick={() => onChange(!enabled)}
          className="w-10 h-6 rounded-full transition-colors cursor-pointer flex items-center px-1"
          style={{ backgroundColor: enabled ? '#5a9228' : '#d1d5db' }}
        >
          <div
            className="w-4 h-4 rounded-full bg-white shadow transition-transform"
            style={{ transform: enabled ? 'translateX(16px)' : 'translateX(0)' }}
          />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium" style={{ color: '#2d5c18' }}>{rule.name}</div>
        <div className="text-xs mt-0.5" style={{ color: '#596570' }}>{rule.description}</div>
      </div>
    </label>
  );
}

// ── Role keywords editor ─────────────────────────────────────────────────────

function KeywordRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [raw, setRaw] = useState(arrayToTagList(value));

  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-3">
      <span className="text-sm font-medium" style={{ color: '#2d5c18' }}>{label}</span>
      <input
        type="text"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={() => onChange(tagListToArray(raw))}
        placeholder="e.g. director, jane smith"
        className="text-sm px-3 py-1.5 rounded-lg border w-full"
        style={{ borderColor: '#c0d0c0', color: '#2d5c18' }}
      />
    </div>
  );
}

// ── Rule set editor modal ────────────────────────────────────────────────────

function RuleSetEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: RuleSet;
  onSave: (set: RuleSet) => void;
  onCancel: () => void;
}) {
  const isDefault = initial.id === 'default';
  const [draft, setDraft] = useState<RuleSet>({ ...initial });

  function toggleRule(ruleId: string) {
    setDraft(prev => ({
      ...prev,
      enabledRuleIds: prev.enabledRuleIds.includes(ruleId)
        ? prev.enabledRuleIds.filter(id => id !== ruleId)
        : [...prev.enabledRuleIds, ruleId],
    }));
  }

  function setKeywords(field: keyof RoleKeywords, val: string[]) {
    setDraft(prev => ({
      ...prev,
      roleKeywords: { ...prev.roleKeywords, [field]: val },
    }));
  }

  // Group rules by category
  const rulesByCategory = STAFFING_RULES.reduce<Record<string, typeof STAFFING_RULES>>(
    (acc, rule) => {
      (acc[rule.category] ??= []).push(rule);
      return acc;
    },
    {}
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-6 px-4 overflow-y-auto"
         style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#e0e8e0' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#2d5c18' }}>
              {isDefault ? 'View Standard Rules' : draft.id.startsWith('new') ? 'New Rule Set' : `Edit: ${draft.name}`}
            </h2>
            {isDefault && (
              <p className="text-xs mt-0.5" style={{ color: '#596570' }}>
                Standard rules are read-only. Create a new rule set to customise.
              </p>
            )}
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Name & description */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-widest mb-1 block" style={{ color: '#5a9228' }}>Name</label>
              <input
                type="text"
                value={draft.name}
                onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                disabled={isDefault}
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{ borderColor: '#c0d0c0', color: '#2d5c18', backgroundColor: isDefault ? '#f9fafb' : 'white' }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-widest mb-1 block" style={{ color: '#5a9228' }}>Description (optional)</label>
              <input
                type="text"
                value={draft.description ?? ''}
                onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
                disabled={isDefault}
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{ borderColor: '#c0d0c0', color: '#2d5c18', backgroundColor: isDefault ? '#f9fafb' : 'white' }}
              />
            </div>
          </div>

          {/* Rules by category */}
          {Object.entries(rulesByCategory).map(([cat, rules]) => (
            <div key={cat}>
              <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#5a9228' }}>
                {RULE_CATEGORIES[cat] ?? cat}
              </div>
              <div className="space-y-3">
                {rules.map(rule => (
                  <RuleToggle
                    key={rule.id}
                    rule={rule}
                    enabled={draft.enabledRuleIds.includes(rule.id)}
                    onChange={isDefault ? () => {} : () => toggleRule(rule.id)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Role keywords */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#5a9228' }}>
              Role Keywords
            </div>
            <p className="text-xs mb-3" style={{ color: '#596570' }}>
              How the system identifies staff roles from their Deputy names. Comma-separated, case-insensitive.
            </p>
            <div className="space-y-2 p-4 rounded-xl" style={{ backgroundColor: '#f5f7f5' }}>
              <KeywordRow label="Director" value={draft.roleKeywords.director}
                onChange={isDefault ? () => {} : v => setKeywords('director', v)} />
              <KeywordRow label="Asst. Director" value={draft.roleKeywords.assistantDirector}
                onChange={isDefault ? () => {} : v => setKeywords('assistantDirector', v)} />
              <KeywordRow label="Ed. Leader" value={draft.roleKeywords.educationalLeader}
                onChange={isDefault ? () => {} : v => setKeywords('educationalLeader', v)} />
              <KeywordRow label="Cook" value={draft.roleKeywords.cook}
                onChange={isDefault ? () => {} : v => setKeywords('cook', v)} />
              <KeywordRow label="Admin" value={draft.roleKeywords.admin}
                onChange={isDefault ? () => {} : v => setKeywords('admin', v)} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: '#e0e8e0' }}>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border text-sm font-medium"
            style={{ borderColor: '#c0d0c0', color: '#596570' }}
          >
            {isDefault ? 'Close' : 'Cancel'}
          </button>
          {!isDefault && (
            <button
              onClick={() => onSave(draft)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white"
              style={{ backgroundColor: '#5a9228' }}
            >
              Save Rule Set
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Config Page ─────────────────────────────────────────────────────────

export default function ConfigPage() {
  const navigate = useNavigate();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>(getRuleSets);
  const [centreConfigs, setCentreConfigsState] = useState(getCentreConfigs);
  const [editingSet, setEditingSet] = useState<RuleSet | null>(null);
  const [saved, setSaved] = useState(false);

  function getCentreRuleSetId(centreId: string): string {
    return centreConfigs.find(c => c.centreId === centreId)?.ruleSetId ?? 'default';
  }

  function handleSaveRuleSet(set: RuleSet) {
    upsertRuleSet(set);
    setRuleSets(getRuleSets());
    setEditingSet(null);
  }

  function handleDeleteRuleSet(id: string) {
    if (!confirm('Delete this rule set? Any centres using it will revert to Standard Rules.')) return;
    deleteRuleSet(id);
    setRuleSets(getRuleSets());
    setCentreConfigsState(getCentreConfigs());
  }

  function handleAssignRuleSet(centreId: string, ruleSetId: string) {
    setCentreRuleSet(centreId, ruleSetId);
    setCentreConfigsState(getCentreConfigs());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function newRuleSet() {
    setEditingSet({
      id: 'new_' + generateId(),
      name: '',
      description: '',
      enabledRuleIds: [...DEFAULT_RULE_SET.enabledRuleIds],
      roleKeywords: { ...DEFAULT_ROLE_KEYWORDS },
    });
  }

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="text-sm font-medium flex items-center gap-1"
          style={{ color: '#5a9228' }}
        >
          ← Back
        </button>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#2d5c18' }}>Staffing Configuration</h1>
          <p className="text-sm" style={{ color: '#596570' }}>
            Define staffing rules and apply them to centres
          </p>
        </div>
        {saved && (
          <span className="ml-auto text-sm font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full">
            ✅ Saved
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Rule Sets ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#5a9228' }}>
              Rule Sets
            </h2>
            <button
              onClick={newRuleSet}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-white"
              style={{ backgroundColor: '#5a9228' }}
            >
              + New Rule Set
            </button>
          </div>

          <div className="space-y-3">
            {ruleSets.map(set => {
              const centresUsing = CENTRES.filter(c => getCentreRuleSetId(c.id) === set.id);
              const isDefault = set.id === 'default';
              return (
                <div
                  key={set.id}
                  className="bg-white rounded-2xl border p-4"
                  style={{ borderColor: '#e0e8e0' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: '#2d5c18' }}>{set.name}</span>
                        {isDefault && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{ backgroundColor: '#E2F1DA', color: '#5a9228' }}>
                            Built-in
                          </span>
                        )}
                        {centresUsing.length > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{ backgroundColor: '#f0f9ff', color: '#0369a1' }}>
                            {centresUsing.map(c => c.name).join(', ')}
                          </span>
                        )}
                      </div>
                      {set.description && (
                        <p className="text-xs mt-1" style={{ color: '#596570' }}>{set.description}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {set.enabledRuleIds.map(id => {
                          const rule = STAFFING_RULES.find(r => r.id === id);
                          if (!rule) return null;
                          return (
                            <span key={id} className="text-xs px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: '#E2F1DA', color: '#2d5a1a' }}>
                              {rule.name}
                            </span>
                          );
                        })}
                        {set.enabledRuleIds.length === 0 && (
                          <span className="text-xs" style={{ color: '#9a9a9a' }}>No rules enabled</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setEditingSet(set)}
                        className="text-xs px-2.5 py-1 rounded-lg border font-medium"
                        style={{ borderColor: '#c0d0c0', color: '#5a9228' }}
                      >
                        {isDefault ? 'View' : 'Edit'}
                      </button>
                      {!isDefault && (
                        <button
                          onClick={() => handleDeleteRuleSet(set.id)}
                          className="text-xs px-2.5 py-1 rounded-lg border font-medium"
                          style={{ borderColor: '#fca5a5', color: '#dc2626' }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Centre Assignments ── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#5a9228' }}>
            Centre Assignments
          </h2>
          <p className="text-xs mb-4" style={{ color: '#596570' }}>
            Choose which rule set applies to each centre. Changes take effect immediately.
          </p>

          <div className="space-y-3">
            {CENTRES.map(centre => {
              const activeSetId = getCentreRuleSetId(centre.id);
              const activeSet = ruleSets.find(s => s.id === activeSetId) ?? DEFAULT_RULE_SET;
              return (
                <div
                  key={centre.id}
                  className="bg-white rounded-2xl border p-4"
                  style={{ borderColor: '#e0e8e0' }}
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="font-semibold text-sm" style={{ color: '#2d5c18' }}>{centre.name}</div>
                      <div className="text-xs" style={{ color: '#596570' }}>
                        {centre.rooms.length} rooms · using: <strong>{activeSet.name}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {ruleSets.map(set => (
                      <button
                        key={set.id}
                        onClick={() => handleAssignRuleSet(centre.id, set.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors"
                        style={{
                          borderColor: activeSetId === set.id ? '#5a9228' : '#c0d0c0',
                          backgroundColor: activeSetId === set.id ? '#5a9228' : 'white',
                          color: activeSetId === set.id ? 'white' : '#5a9228',
                        }}
                      >
                        {set.name}
                        {activeSetId === set.id && ' ✓'}
                      </button>
                    ))}
                  </div>

                  {/* Active rules summary */}
                  <div className="mt-3 pt-3 border-t" style={{ borderColor: '#f0f0f0' }}>
                    <div className="text-xs font-medium mb-1" style={{ color: '#596570' }}>Active rules:</div>
                    <div className="space-y-1">
                      {activeSet.enabledRuleIds.length === 0 && (
                        <p className="text-xs" style={{ color: '#9a9a9a' }}>No rules enabled — only rostered room staff + floats count.</p>
                      )}
                      {activeSet.enabledRuleIds.map(id => {
                        const rule = STAFFING_RULES.find(r => r.id === id);
                        if (!rule) return null;
                        return (
                          <div key={id} className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#5a9228' }} />
                            <span className="text-xs" style={{ color: '#2d5c18' }}>{rule.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Role keywords hint */}
          <div className="mt-4 p-4 rounded-xl border text-xs" style={{ borderColor: '#bae6fd', backgroundColor: '#f0f9ff', color: '#0369a1' }}>
            <strong>💡 Role identification:</strong> Staff are identified by keywords in their Deputy names.
            Edit a rule set to customise keywords (e.g., set "director" to match "Jane Smith" at a specific centre).
          </div>
        </div>
      </div>

      {/* Modal */}
      {editingSet && (
        <RuleSetEditor
          initial={editingSet}
          onSave={handleSaveRuleSet}
          onCancel={() => setEditingSet(null)}
        />
      )}
    </Layout>
  );
}
