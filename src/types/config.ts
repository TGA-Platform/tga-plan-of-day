// ─── Staffing Rules & Centre Configuration Types ───────────────────────────

export type RuleCategory = 'ratio' | 'lunch_cover';
export type StaffRole =
  | 'educator'
  | 'float'
  | 'director'
  | 'assistantDirector'
  | 'educationalLeader'
  | 'cook'
  | 'admin'
  | 'unknown';

export interface StaffingRule {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  /** Which StaffRole values this rule activates */
  targetRoles: StaffRole[];
}

export interface RoleKeywords {
  director: string[];
  assistantDirector: string[];
  educationalLeader: string[];
  cook: string[];
  admin: string[];
}

/** A named set of rules + role-keyword mappings, assignable to any number of centres */
export interface RuleSet {
  id: string;
  name: string;
  description?: string;
  enabledRuleIds: string[];
  roleKeywords: RoleKeywords;
}

/** Links a centre to a rule set */
export interface CentreRuleConfig {
  centreId: string;
  ruleSetId: string;
}

// ─── Optimizer Output Types ──────────────────────────────────────────────────

export interface StaffWithRole {
  employeeId: number;
  employeeName: string;
  role: StaffRole;
  unitId: number;
  startTime?: string;
  endTime?: string;
}

export interface RoomAllocationResult {
  roomId: string;
  roomName: string;
  ratio: number;
  anticipatedChildren: number;
  requiredStaff: number;
  /** Staff whose home unit is this room */
  regularStaff: StaffWithRole[];
  /** Floats / senior staff deployed from the pool to fill gaps */
  additionalStaff: StaffWithRole[];
  totalAllocated: number;
  /** positive = still short, 0 = met, negative = over */
  gap: number;
  casualsNeeded: number;
  notes: string[];
}

export interface AllocationPlan {
  rooms: RoomAllocationResult[];
  /** Qualified pool staff not needed today */
  unusedPool: StaffWithRole[];
  totalCasualsNeeded: number;
  totalFloatsDeployed: number;
  totalSeniorDeployed: number;
  summary: string[];
}
