/**
 * staffingConfig.ts
 * Canonical status options and colours for the staffing structure.
 *
 * Categories:
 *   - Qualification     = educational/certification level
 *   - Position          = job role
 *   - Position Category = employment arrangement (hours/type)
 *   - Employment Status = lifecycle state
 *   - 50% Ratio         = ratio qualification band
 *   - Action            = follow-up action
 */

export interface StatusOption {
  value: string;
  label: string;
  color: string;   // background
  border: string;  // border/text
}

// ── Qualification (education/certification level only) ─────────────────────
export const QUALIFICATION_OPTIONS: StatusOption[] = [
  { value: 'ECT',           label: 'ECT',           color: '#dbeafe', border: '#1e40af' },
  { value: 'WT ECT',        label: 'WT ECT',        color: '#ede9fe', border: '#5b21b6' },
  { value: 'Diploma',       label: 'Diploma',       color: '#dcfce7', border: '#166534' },
  { value: 'WT Diploma',    label: 'WT Diploma',    color: '#d1fae5', border: '#065f46' },
  { value: 'Certificate 3', label: 'Certificate 3', color: '#fef9c3', border: '#854d0e' },
  { value: 'Trainee',       label: 'Trainee',       color: '#ffedd5', border: '#9a3412' },
  { value: 'ISS',           label: 'ISS',           color: '#f3e8ff', border: '#7e22ce' },
  { value: 'Chef',          label: 'Chef',          color: '#fce7f3', border: '#9d174d' },
  { value: 'No Qualification', label: 'No Qual',    color: '#f1f5f9', border: '#64748b' },
];

// ── Employment Status (lifecycle state only) ───────────────────────────────
export const EMPLOYMENT_STATUS_OPTIONS: StatusOption[] = [
  { value: 'Active',        label: 'Active',        color: '#00c875', border: '#00b461' },
  { value: 'Probation',     label: 'Probation',     color: '#fdab3d', border: '#e99729' },
  { value: 'On Leave',      label: 'On Leave',      color: '#facc15', border: '#a16207' },
  { value: 'PPL',           label: 'PPL',           color: '#579bfc', border: '#4086e0' },
  { value: 'Long Service',  label: 'Long Service',  color: '#a0c4ff', border: '#6a9fd8' },
  { value: 'Inactive',      label: 'Inactive',      color: '#f1f5f9', border: '#64748b' },
  { value: 'Resigned',      label: 'Resigned',      color: '#df2f4a', border: '#ce3048' },
  { value: 'Exited',        label: 'Exited',        color: '#9ca3af', border: '#4b5563' },
];

// ── Position (job role only) ───────────────────────────────────────────────
export const POSITION_OPTIONS: StatusOption[] = [
  { value: 'Centre Director',                   label: 'Centre Director',         color: '#0075ff', border: '#0060cc' },
  { value: 'Assistant Director',                label: 'Assistant Director',      color: '#579bfc', border: '#4086e0' },
  { value: 'Educational Leader',                label: 'Educational Leader',      color: '#a0c4ff', border: '#6a9fd8' },
  { value: 'Room Leader',                       label: 'Room Leader',             color: '#00c875', border: '#00b461' },
  { value: 'Early Childhood Teacher',           label: 'ECT',                     color: '#dcfce7', border: '#166534' },
  { value: 'Early Childhood Teacher Room Leader', label: 'ECT Room Leader',       color: '#bbf7d0', border: '#166534' },
  { value: 'Educator',                          label: 'Educator',                color: '#E2F1DA', border: '#2d5c18' },
  { value: 'Mama Bear',                         label: 'Mama Bear',               color: '#fce7f3', border: '#9d174d' },
  { value: 'Trainee',                           label: 'Trainee',                 color: '#ffedd5', border: '#9a3412' },
  { value: 'ISS Support Worker',                label: 'ISS',                     color: '#f3e8ff', border: '#7e22ce' },
  { value: 'Centre Support',                    label: 'Centre Support',          color: '#e0f2fe', border: '#0369a1' },
  { value: 'Chef',                              label: 'Chef',                    color: '#fce7f3', border: '#9d174d' },
];

// ── Position Category (employment arrangement / hours) ─────────────────────
export const POSITION_CATEGORY_OPTIONS: StatusOption[] = [
  { value: 'Full Time',   label: 'Full Time',   color: '#00c875', border: '#00b461' },
  { value: 'Part Time',   label: 'Part Time',   color: '#579bfc', border: '#4086e0' },
  { value: 'Casual',      label: 'Casual',      color: '#fdab3d', border: '#e99729' },
  { value: 'As Required', label: 'As Required', color: '#f3e8ff', border: '#7e22ce' },
];

// ── 50% Ratio ──────────────────────────────────────────────────────────────
export const RATIO_50_OPTIONS: StatusOption[] = [
  { value: 'Diploma & Above', label: 'Diploma & Above', color: '#00c875', border: '#00b461' },
  { value: 'Cert 3 & Below',  label: 'Cert 3 & Below',  color: '#fdab3d', border: '#e99729' },
];

// ── Action ─────────────────────────────────────────────────────────────────
export const ACTION_OPTIONS: StatusOption[] = [
  { value: '',                  label: 'None',               color: '#f1f5f9', border: '#94a3b8' },
  { value: 'Send Onboarding Kit', label: 'Send Onboarding Kit', color: '#00c875', border: '#00b461' },
  { value: 'Renew Contract',    label: 'Renew Contract',     color: '#fdab3d', border: '#e99729' },
  { value: 'Follow Up',         label: 'Follow Up',          color: '#df2f4a', border: '#ce3048' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
export function findOption(options: StatusOption[], value?: string | null): StatusOption | undefined {
  if (!value) return undefined;
  return options.find(o => o.value === value) ??
    options.find(o => o.value.toLowerCase() === value.toLowerCase());
}

// Convenience string arrays for selects / InlineSelect
export const QUALIFICATION_VALUES = QUALIFICATION_OPTIONS.map(o => o.value);
export const EMPLOYMENT_STATUS_VALUES = EMPLOYMENT_STATUS_OPTIONS.map(o => o.value);
export const POSITION_VALUES = POSITION_OPTIONS.map(o => o.value);
export const POSITION_CATEGORY_VALUES = POSITION_CATEGORY_OPTIONS.map(o => o.value);
export const RATIO_50_VALUES = RATIO_50_OPTIONS.map(o => o.value);
export const ACTION_VALUES = ACTION_OPTIONS.map(o => o.value);
