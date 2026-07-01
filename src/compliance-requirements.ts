/**
 * Staff Compliance Requirements by Position/Qualification
 * Based on NSW childcare regulations and TGA internal policies
 */

export interface ComplianceRequirement {
  id: string;
  label: string;
  category: 'certification' | 'document' | 'check';
  requiredFor: string[]; // positions that need this
  requiredForQualifications?: string[]; // qualifications that need this
  expiryField?: string; // field name for expiry date (e.g. 'wwcc_expiry')
  docPattern?: RegExp; // regex to match document label
  isMandatory: boolean; // true = must have, false = recommended
  description?: string;
}

// All possible compliance items
export const COMPLIANCE_REQUIREMENTS: ComplianceRequirement[] = [
  // Certifications (with expiry dates)
  {
    id: 'wwcc',
    label: 'Working with Children Check',
    category: 'certification',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator', 'Trainee', 'Centre Support', 'Chef', 'ISS Support Worker'],
    expiryField: 'wwcc_expiry',
    isMandatory: true,
    description: 'Valid WWCC required for all staff working with children',
  },
  {
    id: 'first_aid',
    label: 'First Aid Certificate',
    category: 'certification',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator'],
    expiryField: 'first_aid_expiry',
    isMandatory: true,
    description: 'HLTAID011 or equivalent',
  },
  {
    id: 'cpr',
    label: 'CPR Certificate',
    category: 'certification',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator'],
    expiryField: 'cpr_expiry',
    isMandatory: true,
    description: 'Current CPR certification',
  },
  {
    id: 'anaphylaxis',
    label: 'Anaphylaxis Training',
    category: 'certification',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator'],
    expiryField: 'anaphylaxis_expiry',
    isMandatory: true,
    description: '22300VIC or equivalent',
  },
  {
    id: 'child_protection',
    label: 'Child Protection Training',
    category: 'certification',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator', 'Trainee'],
    expiryField: 'child_protection_renewal',
    isMandatory: true,
    description: 'Annual refresher required',
  },
  {
    id: 'food_handling',
    label: 'Food Handling Certificate',
    category: 'certification',
    requiredFor: ['Chef', 'Centre Director', 'Assistant Director'],
    // expiryField not tracked in system yet
    isMandatory: true,
    description: 'Required for staff handling food',
  },
  {
    id: 'fire_warden',
    label: 'Fire Warden Training',
    category: 'certification',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader'],
    isMandatory: false,
    description: 'Recommended for leadership team',
  },

  // Documents (no expiry)
  {
    id: 'qualification_cert',
    label: 'Qualification Certificate',
    category: 'document',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator', 'Trainee'],
    docPattern: /qualification|transcript|award/i,
    isMandatory: true,
    description: 'Cert III, Diploma, or ECT qualification',
  },
  {
    id: 'induction',
    label: 'Induction Checklist',
    category: 'document',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator', 'Trainee', 'Centre Support', 'Chef', 'ISS Support Worker'],
    docPattern: /induction/i,
    isMandatory: true,
    description: 'Completed centre induction',
  },
  {
    id: 'policy_kit',
    label: 'Policy Kit Signed',
    category: 'document',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator', 'Trainee', 'Centre Support', 'Chef', 'ISS Support Worker'],
    docPattern: /policy/i,
    isMandatory: true,
    description: 'Signed acknowledgement of policies',
  },
  {
    id: 'staff_record',
    label: 'Staff Record',
    category: 'document',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator', 'Trainee', 'Centre Support', 'Chef', 'ISS Support Worker'],
    docPattern: /staff.?record/i,
    isMandatory: true,
    description: 'Complete staff record form',
  },
  {
    id: 'job_description',
    label: 'Job Description',
    category: 'document',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator', 'Trainee', 'Centre Support', 'Chef', 'ISS Support Worker'],
    docPattern: /job.?desc|position.?desc/i,
    isMandatory: true,
    description: 'Signed position description',
  },
  {
    id: 'employment_contract',
    label: 'Employment Contract',
    category: 'document',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher', 'Educator', 'Trainee', 'Centre Support', 'Chef', 'ISS Support Worker'],
    docPattern: /employment|contract/i,
    isMandatory: true,
    description: 'Signed employment agreement',
  },
  {
    id: 'key_responsibilities',
    label: 'Key Responsibilities',
    category: 'document',
    requiredFor: ['Centre Director', 'Assistant Director', 'Educational Leader', 'Room Leader', 'Early Childhood Teacher'],
    docPattern: /responsib/i,
    isMandatory: false,
    description: 'Signed key responsibilities document',
  },
  {
    id: 'training_contract',
    label: 'Training Contract',
    category: 'document',
    requiredFor: ['Trainee'],
    docPattern: /training.?contract/i,
    isMandatory: true,
    description: 'Registered training contract',
  },
  {
    id: 'training_plan',
    label: 'Training Plan',
    category: 'document',
    requiredFor: ['Trainee'],
    docPattern: /training.?plan/i,
    isMandatory: true,
    description: 'Formal training plan',
  },
  {
    id: 'rp_consent',
    label: 'RP/NS/EL Consent',
    category: 'document',
    requiredFor: ['Room Leader', 'Early Childhood Teacher', 'Educational Leader'],
    docPattern: /consent/i,
    isMandatory: true,
    description: 'Responsible Person / Nominated Supervisor consent',
  },
];

/**
 * Get compliance requirements for a specific position
 */
export function getRequirementsForPosition(position: string | null | undefined): ComplianceRequirement[] {
  if (!position) return [];
  return COMPLIANCE_REQUIREMENTS.filter(req =>
    req.requiredFor.some(r => position.toLowerCase().includes(r.toLowerCase()))
  );
}

/**
 * Calculate compliance score for a staff member
 * Returns: { score: 0-100, items: [...], status: 'compliant' | 'partial' | 'non-compliant' }
 */
export function calculateCompliance(staff: {
  position?: string | null;
  qualification?: string | null;
  wwcc_expiry?: string | null;
  first_aid_expiry?: string | null;
  cpr_expiry?: string | null;
  anaphylaxis_expiry?: string | null;
  child_protection_renewal?: string | null;
  docs?: Array<{ label: string; url: string }>;
  certDocs?: Array<{ label: string; url: string }>;
}) {
  const requirements = getRequirementsForPosition(staff.position);
  if (requirements.length === 0) return { score: 100, items: [], status: 'compliant' as const };

  const items = requirements.map(req => {
    let hasItem = false;
    let isValid = true;
    let daysRemaining: number | null = null;
    let status: 'valid' | 'expiring' | 'expired' | 'missing' = 'missing';

    if (req.category === 'certification' && req.expiryField) {
      const expiry = staff[req.expiryField as keyof typeof staff] as string | null | undefined;
      if (expiry) {
        hasItem = true;
        const expiryDate = new Date(expiry);
        const today = new Date();
        daysRemaining = Math.round((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysRemaining < 0) {
          isValid = false;
          status = 'expired';
        } else if (daysRemaining < 90) {
          status = 'expiring';
        } else {
          status = 'valid';
        }
      }
    } else if (req.category === 'document' && req.docPattern) {
      const allDocs = [...(staff.docs || []), ...(staff.certDocs || [])];
      hasItem = allDocs.some(d => req.docPattern!.test(d.label));
      status = hasItem ? 'valid' : 'missing';
    }

    return {
      ...req,
      hasItem,
      isValid,
      daysRemaining,
      status,
    };
  });

  const mandatoryItems = items.filter(i => i.isMandatory);
  const compliantItems = mandatoryItems.filter(i => i.hasItem && i.isValid);
  const score = mandatoryItems.length > 0
    ? Math.round((compliantItems.length / mandatoryItems.length) * 100)
    : 100;

  const hasExpired = items.some(i => i.status === 'expired');
  const hasMissing = items.some(i => i.isMandatory && i.status === 'missing');
  const hasExpiring = items.some(i => i.status === 'expiring');

  let status: 'compliant' | 'partial' | 'non-compliant';
  if (hasExpired || hasMissing) status = 'non-compliant';
  else if (hasExpiring) status = 'partial';
  else status = 'compliant';

  return { score, items, status };
}
