/**
 * staffingConfig.ts
 * All status options and colours for the staffing structure.
 * Mirrors Monday.com column values — used for badge display and dropdowns.
 */

export interface StatusOption {
  value: string;
  label: string;
  color: string;   // background
  border: string;  // border/text
}

// ── Qualification ──────────────────────────────────────────────────────────
export const QUALIFICATION_OPTIONS: StatusOption[] = [
  { value: 'ECT',           label: 'ECT',           color: '#dbeafe', border: '#1e40af' },
  { value: 'WT ECT',        label: 'WT ECT',        color: '#ede9fe', border: '#5b21b6' },
  { value: 'Diploma',       label: 'Diploma',       color: '#dcfce7', border: '#166534' },
  { value: 'Certificate 3', label: 'Certificate 3', color: '#fef9c3', border: '#854d0e' },
  { value: 'Trainee',       label: 'Trainee',       color: '#ffedd5', border: '#9a3412' },
  { value: 'ISS',           label: 'ISS',           color: '#f3e8ff', border: '#7e22ce' },
  { value: 'Chef',          label: 'Chef',          color: '#fce7f3', border: '#9d174d' },
  { value: 'PPL',           label: 'PPL',           color: '#e0f2fe', border: '#0369a1' },
  { value: 'WT Diploma',    label: 'WT Diploma',    color: '#d1fae5', border: '#065f46' },
  { value: 'No Qualification', label: 'No Qual',    color: '#f1f5f9', border: '#64748b' },
  { value: 'Resigned',      label: 'Resigned',      color: '#fee2e2', border: '#991b1b' },
];

// ── Employment Status ──────────────────────────────────────────────────────
export const EMPLOYMENT_STATUS_OPTIONS: StatusOption[] = [
  { value: 'Active',        label: 'Active',        color: '#00c875', border: '#00b461' },
  { value: 'Inactive',      label: 'Inactive',      color: '#f1f5f9', border: '#64748b' },
  { value: 'PPL',           label: 'PPL',           color: '#579bfc', border: '#4086e0' },
  { value: 'Long Service',  label: 'Long Service',  color: '#a0c4ff', border: '#6a9fd8' },
  { value: 'Probation',     label: 'Probation',     color: '#fdab3d', border: '#e99729' },
  { value: 'Casual',        label: 'Casual',        color: '#ffcb00', border: '#d4a800' },
  { value: 'Resigned',      label: 'Resigned',      color: '#df2f4a', border: '#ce3048' },
];

// ── Position ───────────────────────────────────────────────────────────────
export const POSITION_OPTIONS: StatusOption[] = [
  { value: 'Centre Director',         label: 'Centre Director',         color: '#0075ff', border: '#0060cc' },
  { value: 'Assistant Director',      label: 'Assistant Director',      color: '#579bfc', border: '#4086e0' },
  { value: 'Educational Leader',      label: 'Educational Leader',      color: '#a0c4ff', border: '#6a9fd8' },
  { value: 'Room Leader',             label: 'Room Leader',             color: '#00c875', border: '#00b461' },
  { value: 'Early Childhood Teacher', label: 'ECT',                     color: '#dcfce7', border: '#166534' },
  { value: 'Early Childhood Teacher Room Leader', label: 'ECT Room Leader', color: '#bbf7d0', border: '#166534' },
  { value: 'Educator',                label: 'Educator',                color: '#E2F1DA', border: '#2d5c18' },
  { value: 'Mama Bear Educator',      label: 'Mama Bear',               color: '#fce7f3', border: '#9d174d' },
  { value: 'Mama Bear',               label: 'Mama Bear',               color: '#fce7f3', border: '#9d174d' },
  { value: 'Childcare Trainee',       label: 'Trainee',                 color: '#ffedd5', border: '#9a3412' },
  { value: 'Trainee',                 label: 'Trainee',                 color: '#ffedd5', border: '#9a3412' },
  { value: 'Casual Educator',         label: 'Casual',                  color: '#fef9c3', border: '#854d0e' },
  { value: 'Internal Casual Educator',label: 'Internal Casual',         color: '#fef3c7', border: '#92400e' },
  { value: 'ISS Support Worker',      label: 'ISS',                     color: '#f3e8ff', border: '#7e22ce' },
  { value: 'Diploma Educator',        label: 'Diploma Educator',        color: '#d1fae5', border: '#065f46' },
  { value: 'Centre Support',          label: 'Centre Support',          color: '#e0f2fe', border: '#0369a1' },
  { value: 'Chef',                    label: 'Chef',                    color: '#fce7f3', border: '#9d174d' },
];

// ── Position Category ──────────────────────────────────────────────────────
export const POSITION_CATEGORY_OPTIONS: StatusOption[] = [
  { value: 'Full Time',  label: 'Full Time',  color: '#00c875', border: '#00b461' },
  { value: 'Part Time',  label: 'Part Time',  color: '#579bfc', border: '#4086e0' },
  { value: 'Casual',     label: 'Casual',     color: '#fdab3d', border: '#e99729' },
  { value: 'As Required',label: 'As Required',color: '#f3e8ff', border: '#7e22ce' },
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

// Helper: find option by value
export function findOption(options: StatusOption[], value?: string | null): StatusOption | undefined {
  if (!value) return undefined;
  return options.find(o => o.value === value) ??
    options.find(o => o.value.toLowerCase() === value.toLowerCase());
}
