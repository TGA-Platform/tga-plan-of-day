import type { RuleSet, CentreRuleConfig, RoleKeywords } from '../types/config';

const RULE_SETS_KEY = 'pod_rule_sets';
const CENTRE_CONFIGS_KEY = 'pod_centre_configs';

export const DEFAULT_ROLE_KEYWORDS: RoleKeywords = {
  director: ['director'],
  assistantDirector: ['assistant director', 'asst. director', 'asst director'],
  educationalLeader: ['educational leader', 'ed leader', ' el '],
  cook: ['cook', 'chef'],
  admin: ['admin', 'administration', 'administrator'],
};

export const DEFAULT_RULE_SET: RuleSet = {
  id: 'default',
  name: 'Standard Rules',
  description: 'Default rules — AD and EL count for ratio and can cover lunch.',
  enabledRuleIds: [
    'ad_counts_ratio',
    'el_counts_ratio',
    'ad_covers_lunch',
    'el_covers_lunch',
  ],
  roleKeywords: DEFAULT_ROLE_KEYWORDS,
};

// ── Rule Sets ────────────────────────────────────────────────────────────────

export function getRuleSets(): RuleSet[] {
  try {
    const stored = localStorage.getItem(RULE_SETS_KEY);
    if (!stored) return [DEFAULT_RULE_SET];
    const parsed = JSON.parse(stored) as RuleSet[];
    // Always keep default in sync
    const without = parsed.filter(s => s.id !== 'default');
    return [DEFAULT_RULE_SET, ...without];
  } catch {
    return [DEFAULT_RULE_SET];
  }
}

export function saveRuleSets(sets: RuleSet[]): void {
  // Never persist 'default' — it's always generated from DEFAULT_RULE_SET
  const toSave = sets.filter(s => s.id !== 'default');
  localStorage.setItem(RULE_SETS_KEY, JSON.stringify(toSave));
}

export function getRuleSetById(id: string): RuleSet {
  const sets = getRuleSets();
  return sets.find(s => s.id === id) ?? DEFAULT_RULE_SET;
}

export function upsertRuleSet(set: RuleSet): void {
  const sets = getRuleSets();
  const idx = sets.findIndex(s => s.id === set.id);
  if (idx >= 0) sets[idx] = set;
  else sets.push(set);
  saveRuleSets(sets);
}

export function deleteRuleSet(id: string): void {
  if (id === 'default') return;
  const sets = getRuleSets().filter(s => s.id !== id);
  saveRuleSets(sets);
  // Unlink any centres using this set
  const configs = getCentreConfigs().map(c =>
    c.ruleSetId === id ? { ...c, ruleSetId: 'default' } : c
  );
  saveCentreConfigs(configs);
}

// ── Centre Configs ────────────────────────────────────────────────────────────

export function getCentreConfigs(): CentreRuleConfig[] {
  try {
    const stored = localStorage.getItem(CENTRE_CONFIGS_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as CentreRuleConfig[];
  } catch {
    return [];
  }
}

export function saveCentreConfigs(configs: CentreRuleConfig[]): void {
  localStorage.setItem(CENTRE_CONFIGS_KEY, JSON.stringify(configs));
}

export function getCentreRuleSet(centreId: string): RuleSet {
  const configs = getCentreConfigs();
  const config = configs.find(c => c.centreId === centreId);
  if (!config) return DEFAULT_RULE_SET;
  return getRuleSetById(config.ruleSetId);
}

export function setCentreRuleSet(centreId: string, ruleSetId: string): void {
  const configs = getCentreConfigs();
  const idx = configs.findIndex(c => c.centreId === centreId);
  if (idx >= 0) configs[idx].ruleSetId = ruleSetId;
  else configs.push({ centreId, ruleSetId });
  saveCentreConfigs(configs);
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
