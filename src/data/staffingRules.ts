import type { StaffingRule } from '../types/config';

export const STAFFING_RULES: StaffingRule[] = [
  // ── Ratio rules ──────────────────────────────────────────────────────────
  {
    id: 'director_counts_ratio',
    name: 'Director counts for ratio',
    description:
      'The Director can step on the floor and be counted towards room ratio when a room is short-staffed.',
    category: 'ratio',
    targetRoles: ['director'],
  },
  {
    id: 'ad_counts_ratio',
    name: 'Assistant Director counts for ratio',
    description:
      'The Assistant Director can be deployed to any room and counted towards ratio.',
    category: 'ratio',
    targetRoles: ['assistantDirector'],
  },
  {
    id: 'el_counts_ratio',
    name: 'Educational Leader counts for ratio',
    description:
      'The Educational Leader can step into rooms and count towards ratio when needed.',
    category: 'ratio',
    targetRoles: ['educationalLeader'],
  },
  {
    id: 'cook_counts_ratio',
    name: 'Cook counts for ratio (non-cooking hours)',
    description:
      'The Cook can be counted towards ratio in 3+ yr rooms outside their cooking window.',
    category: 'ratio',
    targetRoles: ['cook'],
  },

  // ── Lunch cover rules ────────────────────────────────────────────────────
  {
    id: 'ad_covers_lunch',
    name: 'Assistant Director covers lunch breaks',
    description:
      'The AD can relieve room educators during the lunch window (11:30 am – 2:00 pm), covering breaks so ratios are maintained without a casual.',
    category: 'lunch_cover',
    targetRoles: ['assistantDirector'],
  },
  {
    id: 'el_covers_lunch',
    name: 'Educational Leader covers lunch breaks',
    description:
      'The EL can cover room educators during their scheduled lunch break.',
    category: 'lunch_cover',
    targetRoles: ['educationalLeader'],
  },
  {
    id: 'director_covers_lunch',
    name: 'Director covers lunch breaks',
    description:
      'The Director can relieve room educators during the lunch window when operationally appropriate.',
    category: 'lunch_cover',
    targetRoles: ['director'],
  },
];

export const RULE_CATEGORIES: Record<string, string> = {
  ratio: 'Ratio Coverage',
  lunch_cover: 'Lunch Break Cover',
};
