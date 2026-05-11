import type { Centre, User } from './types';

export const DEPUTY_TOKEN = import.meta.env.VITE_DEPUTY_TOKEN || 'cf73b1628a5e3498d713879bcf07a974';
export const DEPUTY_HOST = 'thegroveacademy.au.deputy.com';
export const OWNA_BASE = 'https://hq.owna.com.au';
export const OWNA_USER = 'claude@tga.edu.au';
export const OWNA_PASS = import.meta.env.VITE_OWNA_PASS || 'Orange6512*';
export const OWNA_OATLEY_CENTRE_ID = parseInt(import.meta.env.VITE_OWNA_OATLEY_CENTRE_ID || '1'); // Oatley ID
export const DEPUTY_BASE = `https://${DEPUTY_HOST}/api/v1`;

// Oatley room IDs discovered from Deputy API
export const OATLEY_ROOMS = {
  explorers: 213,
  adventurers: 132,
  pioneers: 133,
  voyagers: 196,
  creators: 159,
  achievers: 223,
  floats: 224,
  annualLeave: 134,
  sickLeave: 142,
};

export const CENTRES: Centre[] = [
  {
    id: 'oatley',
    name: 'Oatley',
    deputyCompanyId: undefined,
    rooms: [
      { id: 'explorers', name: 'Explorers', ageGroup: '0-1 yrs', ratio: 4, deputyUnitId: 213 },
      { id: 'adventurers', name: 'Adventurers', ageGroup: '1-2 yrs', ratio: 4, deputyUnitId: 132 },
      { id: 'pioneers', name: 'Pioneers', ageGroup: '2-3 yrs', ratio: 5, deputyUnitId: 133 },
      { id: 'voyagers', name: 'Voyagers', ageGroup: '2.5-3.5 yrs', ratio: 5, deputyUnitId: 196 },
      { id: 'creators', name: 'Creators', ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 159 },
      { id: 'achievers', name: 'Achievers', ageGroup: '3.5-5 yrs', ratio: 10, deputyUnitId: 223 },
    ],
  },
];

export const USERS: User[] = [
  { email: 'matt@tga.edu.au', role: 'ceo', centreId: 'oatley', name: 'Matt' },
  { email: 'oatley@tga.edu.au', role: 'director', centreId: 'oatley', name: 'Oatley Director' },
  { email: 'director@tga.edu.au', role: 'director', centreId: 'oatley', name: 'Director' },
];

export const PASSWORDS: Record<string, string> = {
  'matt@tga.edu.au': 'admin123',
  'oatley@tga.edu.au': 'oatley2026',
  'director@tga.edu.au': 'director2026',
};

// Default sample attendance per room (can be overridden)
export const DEFAULT_ATTENDANCE: Record<string, number> = {
  explorers: 8,
  adventurers: 10,
  pioneers: 12,
  voyagers: 13,
  creators: 18,
  achievers: 20,
};
