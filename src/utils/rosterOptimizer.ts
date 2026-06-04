/**
 * rosterOptimizer.ts
 *
 * Takes all rostered staff for a day and produces an optimised allocation plan:
 *   1. Room educators stay in their rooms
 *   2. Gaps filled by: floats → senior roles (per rules) → casuals (last resort)
 *
 * Produces a clear assignment plan showing exactly where each person should be.
 */

import type { RosteredStaff } from '../types';
import type {
  StaffRole,
  StaffWithRole,
  RoomAllocationResult,
  AllocationPlan,
  RuleSet,
} from '../types/config';
import { STAFFING_RULES } from '../data/staffingRules';
import { getStaffRequired } from '../attendance';

// ── Role identification ──────────────────────────────────────────────────────

export function identifyRole(name: string, keywords: RuleSet['roleKeywords']): StaffRole {
  const lower = name.toLowerCase();
  if (keywords.director.some(k => lower.includes(k.toLowerCase()))) return 'director';
  if (keywords.assistantDirector.some(k => lower.includes(k.toLowerCase()))) return 'assistantDirector';
  if (keywords.educationalLeader.some(k => lower.includes(k.toLowerCase()))) return 'educationalLeader';
  if (keywords.cook.some(k => lower.includes(k.toLowerCase()))) return 'cook';
  if (keywords.admin.some(k => lower.includes(k.toLowerCase()))) return 'admin';
  return 'educator';
}

export function roleLabel(role: StaffRole): string {
  switch (role) {
    case 'director': return 'Director';
    case 'assistantDirector': return 'Asst. Director';
    case 'educationalLeader': return 'Educational Leader';
    case 'float': return 'Float';
    case 'cook': return 'Cook';
    case 'admin': return 'Admin';
    default: return 'Educator';
  }
}

// ── Rules helpers ────────────────────────────────────────────────────────────

/** Roles that can fill RATIO gaps (floats always eligible, others depend on rules) */
export function getRatioEligibleRoles(ruleSet: RuleSet): Set<StaffRole> {
  const eligible = new Set<StaffRole>(['educator', 'float']);
  for (const rule of STAFFING_RULES.filter(r => r.category === 'ratio')) {
    if (ruleSet.enabledRuleIds.includes(rule.id)) {
      for (const role of rule.targetRoles) eligible.add(role);
    }
  }
  return eligible;
}

/** Roles that can cover LUNCH breaks (floats always eligible, others depend on rules) */
export function getLunchEligibleRoles(ruleSet: RuleSet): Set<StaffRole> {
  const eligible = new Set<StaffRole>(['float']);
  for (const rule of STAFFING_RULES.filter(r => r.category === 'lunch_cover')) {
    if (ruleSet.enabledRuleIds.includes(rule.id)) {
      for (const role of rule.targetRoles) eligible.add(role);
    }
  }
  return eligible;
}

// ── Priority order for gap-filling ──────────────────────────────────────────
// Floats first, then senior roles in order of "least disruption"
const POOL_PRIORITY: StaffRole[] = [
  'float',
  'educationalLeader',
  'assistantDirector',
  'director',
  'cook',
];

export interface OptimizerRoom {
  id: string;
  name: string;
  ratio: number;
  deputyUnitId: number;
}

// ── Main optimizer ──────────────────────────────────────────────────────────

export function runOptimizer(params: {
  rooms: OptimizerRoom[];
  rosters: RosteredStaff[];
  roomAttendance: Record<string, number>; // roomId → anticipated children
  ruleSet: RuleSet;
  floatUnitId: number;
  ignoreUnitIds: number[]; // leave units, etc.
}): AllocationPlan {
  const { rooms, rosters, roomAttendance, ruleSet, floatUnitId, ignoreUnitIds } = params;
  const ratioEligible = getRatioEligibleRoles(ruleSet);
  const roomUnitIds = new Set(rooms.map(r => r.deputyUnitId));

  // ── 1. Build de-duped staff list with roles ──────────────────────────────
  const allStaff = new Map<number, StaffWithRole>();
  for (const r of rosters) {
    if (ignoreUnitIds.includes(r.unitId)) continue;
    if (allStaff.has(r.employeeId)) continue;

    const role: StaffRole = r.unitId === floatUnitId
      ? 'float'
      : roomUnitIds.has(r.unitId)
        ? 'educator'
        : identifyRole(r.employeeName, ruleSet.roleKeywords);

    allStaff.set(r.employeeId, {
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      role,
      unitId: r.unitId,
      startTime: r.startTime,
      endTime: r.endTime,
    });
  }

  // ── 2. Separate room educators from deployable pool ──────────────────────
  // Pool = floats + any senior role that's ratio-eligible per current rules
  const pool: StaffWithRole[] = [];
  for (const s of allStaff.values()) {
    if (s.role !== 'educator' && ratioEligible.has(s.role)) {
      pool.push(s);
    }
  }

  // Sort pool by priority: floats first, then EL → AD → Director
  pool.sort((a, b) => {
    const pa = POOL_PRIORITY.indexOf(a.role);
    const pb = POOL_PRIORITY.indexOf(b.role);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  const deployedPool = new Set<number>();

  // ── 3. Allocate each room ────────────────────────────────────────────────
  const roomResults: RoomAllocationResult[] = [];

  for (const room of rooms) {
    const anticipated = roomAttendance[room.id] ?? 0;
    const required = getStaffRequired(anticipated, room.ratio);

    // Staff whose home unit is this room
    const regularStaff = [...allStaff.values()].filter(
      s => s.unitId === room.deputyUnitId
    );
    let allocated = regularStaff.length;
    const additionalStaff: StaffWithRole[] = [];
    const notes: string[] = [];

    // Fill gaps from pool (floats first, then EL → AD → Director)
    if (allocated < required) {
      const gap = required - allocated;
      const available = pool.filter(s => !deployedPool.has(s.employeeId));
      const toAssign = available.slice(0, gap);

      for (const s of toAssign) {
        deployedPool.add(s.employeeId);
        additionalStaff.push(s);
        allocated++;
        notes.push(
          `${s.employeeName} (${roleLabel(s.role)}) → deployed to ${room.name} to meet ratio`
        );
      }
    }

    const finalGap = Math.max(0, required - allocated);
    if (finalGap > 0) {
      notes.push(
        `${finalGap} casual${finalGap > 1 ? 's' : ''} still needed — no eligible staff remaining in pool`
      );
    }

    roomResults.push({
      roomId: room.id,
      roomName: room.name,
      ratio: room.ratio,
      anticipatedChildren: anticipated,
      requiredStaff: required,
      regularStaff,
      additionalStaff,
      totalAllocated: allocated,
      gap: required - allocated,
      casualsNeeded: finalGap,
      notes,
    });
  }

  // ── 4. Summarize ─────────────────────────────────────────────────────────
  const unusedPool = pool.filter(s => !deployedPool.has(s.employeeId));
  const totalCasualsNeeded = roomResults.reduce((sum, r) => sum + r.casualsNeeded, 0);
  const totalFloatsDeployed = [...deployedPool].filter(
    id => allStaff.get(id)?.role === 'float'
  ).length;
  const totalSeniorDeployed = [...deployedPool].length - totalFloatsDeployed;

  const summary: string[] = [];
  if (totalCasualsNeeded === 0) {
    summary.push('✅ All rooms covered — no casuals needed.');
  } else {
    summary.push(
      `⚠️ ${totalCasualsNeeded} casual${totalCasualsNeeded > 1 ? 's' : ''} needed after deploying all available staff.`
    );
  }
  if (totalFloatsDeployed > 0) {
    summary.push(`🔄 ${totalFloatsDeployed} float${totalFloatsDeployed > 1 ? 's' : ''} deployed to cover room gaps.`);
  }
  if (totalSeniorDeployed > 0) {
    summary.push(`👥 ${totalSeniorDeployed} senior staff deployed per centre rules.`);
  }
  if (unusedPool.length > 0) {
    const names = unusedPool.map(s => `${s.employeeName} (${roleLabel(s.role)})`).join(', ');
    summary.push(`📋 Not needed today: ${names}.`);
  }

  return {
    rooms: roomResults,
    unusedPool,
    totalCasualsNeeded,
    totalFloatsDeployed,
    totalSeniorDeployed,
    summary,
  };
}
