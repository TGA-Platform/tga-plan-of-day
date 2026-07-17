import type { Centre, Room, User } from './types';

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

// Helper: rooms with age-range prefix ownaRoomName so they match Owna's "X-Y Room" naming
// ratio is informational; actual cascade uses child ages from Supabase
function room(id: string, name: string, ageGroup: string, ratio: number, deputyUnitId: number, ownaPrefix: string): Room {
  return { id, name, ageGroup, ratio, deputyUnitId, ownaRoomName: ownaPrefix + ' Room' };
}

// Monday.com staffing structure board ID per centre
export const STAFFING_BOARD_IDS: Record<string, number> = {
  'oatley':           1419063930,
  'wollongong':       983834623,
  'mount-annan':      980348329,
  'spring-farm':      6513027863,
  'denham-court':     6247438158,
  'ed-park-1':        983840576,
  'ed-park-2':        3448154419,
  'wilton':           8719103624,
  'dapto-1':          1841109563,
  'dapto-2':          3349576958,
  'north-wollongong': 6248473627,
  'shell-cove':       8347556299,
  'bexley':           983830380,
  'belfield':         9133300009,
  'bankstown':        9133302478,
  'glendale':         18406250043,
  'edgeworth':        9060612097,
};

export const CENTRES: Centre[] = [
  {
    id: 'oatley',
    name: 'Oatley',
    approvedPlaces: 132,
    deputyCompanyId: undefined,
    floatUnitIds:    [224],
    issUnitIds:      [230],      // Float Staff + ISS
    leaveUnitIds:    [134, 142, 139],  // Annual Leave, Sick Leave, Public Holiday
    nonRatioUnitIds: [130, 131, 197, 165, 141, 235, 324, 337], // Director, AD, Chef, Study, Meeting, Admin, Events, Ed Leader
    outdoorAreas:    ['Outdoor Area'],  // Configurable per centre — add more as needed
    rooms: [
      { id: 'explorers',   name: 'Explorers',   ageGroup: '0-1 yrs',     ratio: 4,  deputyUnitId: 213, ownaRoomName: 'Explorers',   roomAliases: ['0-1 Room'] },
      { id: 'adventurers', name: 'Adventurers', ageGroup: '1-2 yrs',     ratio: 4,  deputyUnitId: 132, ownaRoomName: 'Adventurers', roomAliases: ['1-2 Room'] },
      { id: 'pioneers',    name: 'Pioneers',    ageGroup: '2-3 yrs',     ratio: 5,  deputyUnitId: 133, ownaRoomName: 'Pioneers',    roomAliases: ['2-3 Room 1'] },
      { id: 'voyagers',    name: 'Voyagers',    ageGroup: '2.5-3.5 yrs', ratio: 5,  deputyUnitId: 196, ownaRoomName: 'Voyagers',    roomAliases: ['2.5-3.5 Room'] },
      { id: 'creators',    name: 'Creators',    ageGroup: '3-4 yrs',     ratio: 10, deputyUnitId: 159, ownaRoomName: 'Creators',    roomAliases: ['3-4 Room'] },
      { id: 'achievers',   name: 'Achievers',   ageGroup: '3.5-5 yrs',   ratio: 10, deputyUnitId: 223, ownaRoomName: 'Achievers',   roomAliases: ['3.5-5 Room'] },
    ],
  },
  {
    id: 'wollongong',
    name: 'Wollongong',
    approvedPlaces: 61,
    rooms: [
      { id: 'w_0_2', name: '0-2 Explorers', ageGroup: '0-2 yrs', ratio: 4,  deputyUnitId: 118, ownaRoomName: '0-2 Room' },
      { id: 'w_2_3', name: '2-3 Voyagers',  ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 119, ownaRoomName: '2-3 Room' },
      { id: 'w_3_5', name: '3-5 Achievers', ageGroup: '3-5 yrs', ratio: 10, deputyUnitId: 201, ownaRoomName: '3-5 Room' },
    ],
    floatUnitIds:    [126],
    issUnitIds:      [231],
    leaveUnitIds:    [128, 460, 127],
    nonRatioUnitIds: [116, 117, 124, 166, 202, 312, 326, 339],
  },
  {
    id: 'mount-annan', name: 'Mount Annan',
    approvedPlaces: 120,
    openingTime: '06:30',
    rooms: [
      room('ma_0_1', '0-1 Explorers',   '0-1 yrs', 4,  74,  '0-1'),
      room('ma_1_2', '1-2 Adventurers', '1-2 yrs', 4,  76,  '1-2'),
      room('ma_2_3', '2-3 Voyagers',    '2-3 yrs', 5,  221, '2-3'),
      room('ma_3_4', '3-4 Creators',    '3-4 yrs', 10, 78,  '3-4'),
      room('ma_4_5', '4-5 Achievers',   '4-5 yrs', 10, 193, '4-5'),
    ],
    floatUnitIds:    [222],
    issUnitIds:      [225],
    leaveUnitIds:    [108, 456, 109],
    nonRatioUnitIds: [72, 73, 101, 162, 234, 323, 335, 79],
  },
  {
    id: 'spring-farm', name: 'Spring Farm',
    approvedPlaces: 68,
    rooms: [
      { id: 'sf_0_1', name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 265, ownaRoomName: 'Explorers',   roomAliases: ['0-1'] },
      { id: 'sf_1_2', name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 266, ownaRoomName: 'Adventurers', roomAliases: ['1-2'] },
      { id: 'sf_2_3', name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 267, ownaRoomName: 'Voyagers',    roomAliases: ['2-3'] },
      { id: 'sf_3_5', name: '3-5 Achievers',   ageGroup: '3-5 yrs', ratio: 10, deputyUnitId: 269, ownaRoomName: 'Achievers',   roomAliases: ['3-5'] },
    ],
    floatUnitIds:    [270],
    issUnitIds:      [278],
    leaveUnitIds:    [272, 273, 275],
    nonRatioUnitIds: [263, 264, 277, 271, 311, 325, 338, 279],
  },
  {
    id: 'denham-court', name: 'Denham Court',
    approvedPlaces: 109,
    rooms: [
      { id: 'dc_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 247, ownaRoomName: 'Explorers',   roomAliases: ['0-1'] },
      { id: 'dc_1_2',  name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 248, ownaRoomName: 'Adventurers', roomAliases: ['1-2'] },
      { id: 'dc_2_3a', name: '2-3 Pioneers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 300, ownaRoomName: 'Pioneers',    roomAliases: ['2-3 Room 1'] },
      { id: 'dc_2_3b', name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 249, ownaRoomName: 'Voyagers',    roomAliases: ['2-3 Room 2'] },
      { id: 'dc_3_4',  name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 250, ownaRoomName: 'Creators',    roomAliases: ['3-4'] },
      { id: 'dc_4_5',  name: '4-5 Achievers',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 251, ownaRoomName: 'Achievers',   roomAliases: ['4-5'] },
    ],
    floatUnitIds:    [252],
    issUnitIds:      [260],
    leaveUnitIds:    [254, 448, 257],
    nonRatioUnitIds: [245, 246, 259, 253, 301, 320, 333, 261],
  },
  {
    id: 'ed-park-1', name: 'Edmondson Park 1', ownaName: 'Ed Park 1',
    approvedPlaces: 89,
    rooms: [
      room('ep1_0_1', '0-1 Explorers',   '0-1 yrs', 4,  91,  '0-1'),
      room('ep1_1_2', '1-2 Adventurers', '1-2 yrs', 4,  92,  '1-2'),
      room('ep1_2_3', '2-3 Voyagers',    '2-3 yrs', 5,  93,  '2-3'),
      room('ep1_3_4', '3-4 Creators',    '3-4 yrs', 10, 103, '3-4'),
      room('ep1_4_5', '4-5 Achievers',   '4-5 yrs', 10, 204, '4-5'),
    ],
    floatUnitIds:    [207],
    issUnitIds:      [228],
    leaveUnitIds:    [102, 454, 100],
    nonRatioUnitIds: [89, 90, 94, 163, 308, 321, 340, 104],
  },
  {
    id: 'ed-park-2', name: 'Edmondson Park 2', ownaName: 'Ed Park 2',
    approvedPlaces: 89,
    rooms: [
      room('ep2_0_1', '0-1 Explorers',   '0-1 yrs', 4,  174, '0-1'),
      room('ep2_1_2', '1-2 Adventurers', '1-2 yrs', 4,  175, '1-2'),
      room('ep2_2_3', '2-3 Voyagers',    '2-3 yrs', 5,  187, '2-3'),
      room('ep2_3_4', '3-4 Creators',    '3-4 yrs', 10, 218, '3-4'),
      room('ep2_4_5', '4-5 Achievers',   '4-5 yrs', 10, 219, '4-5'),
    ],
    floatUnitIds:    [220],
    issUnitIds:      [229],
    leaveUnitIds:    [188, 455, 194],
    nonRatioUnitIds: [172, 173, 190, 191, 309, 322, 334, 177],
  },
  {
    id: 'wilton', name: 'Wilton',
    approvedPlaces: 116,
    rooms: [
      { id: 'wil_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 366, ownaRoomName: 'Explorers 0-1' },
      { id: 'wil_1_2a', name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 367, ownaRoomName: 'Adventurers 1-2' },
      { id: 'wil_1_2b', name: '1-2 Wonderers',   ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 428, ownaRoomName: 'Wonderers 1-2' },
      { id: 'wil_2_3a', name: '2-3 Pioneers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 368, ownaRoomName: 'Pioneers 2-3' },
      { id: 'wil_2_3b', name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 369, ownaRoomName: 'Voyagers 2-3' },
      { id: 'wil_3_4',  name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 370, ownaRoomName: 'Creators 3-4' },
      { id: 'wil_4_5',  name: '4-5 Achievers',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 371, ownaRoomName: 'Achievers 4-5' },
    ],
    floatUnitIds:    [372],
    issUnitIds:      [365],
    leaveUnitIds:    [442, 459, 376],
    nonRatioUnitIds: [360, 361, 362, 363, 364, 374, 375, 373],
  },
  {
    id: 'dapto-1', name: 'Dapto 1',
    approvedPlaces: 88,
    rooms: [
      room('d1_0_1', '0-1 Explorers',   '0-1 yrs', 4,  137, '0-1'),
      room('d1_1_2', '1-2 Adventurers', '1-2 yrs', 4,  138, '1-2'),
      room('d1_2_3', '2-3 Voyagers',    '2-3 yrs', 5,  182, '2-3'),
      room('d1_3_4', '3-4 Creators',    '3-4 yrs', 10, 183, '3-4'),
      room('d1_4_5', '4-5 Achievers',   '4-5 yrs', 10, 170, '4-5'),
    ],
    floatUnitIds:    [205],
    issUnitIds:      [233],
    leaveUnitIds:    [144, 452, 145],
    nonRatioUnitIds: [135, 136, 143, 167, 306, 331, 146],
  },
  {
    id: 'dapto-2', name: 'Dapto 2',
    approvedPlaces: 90,
    rooms: [
      { id: 'd2_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 155, ownaRoomName: 'Explorers' },
      { id: 'd2_1_2',  name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 186, ownaRoomName: 'Adventurers' },
      { id: 'd2_2_3',  name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 157, ownaRoomName: 'Voyagers' },
      { id: 'd2_3_4a', name: '3-4 Pioneers',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 203, ownaRoomName: 'Pioneers' },
      { id: 'd2_3_4b', name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 184, ownaRoomName: 'Creators' },
      { id: 'd2_4_5',  name: '4-5 Achievers',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 156, ownaRoomName: 'Achievers' },
    ],
    floatUnitIds:    [206],
    issUnitIds:      [227],
    leaveUnitIds:    [185, 211, 160],
    nonRatioUnitIds: [153, 154, 217, 168, 307, 319, 332, 161],
  },
  {
    id: 'north-wollongong', name: 'North Wollongong',
    approvedPlaces: 100,
    rooms: [
      { id: 'nw_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 283, ownaRoomName: 'Explorers' },
      { id: 'nw_1_2',  name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 284, ownaRoomName: 'Adventurers' },
      { id: 'nw_2_3a', name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 285, ownaRoomName: 'Voyagers' },
      { id: 'nw_2_3b', name: '2-3 Creators',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 286, ownaRoomName: 'Creators' },
      { id: 'nw_3_5',  name: '3-5 Achievers',   ageGroup: '3-5 yrs', ratio: 10, deputyUnitId: 327, ownaRoomName: 'Achievers' },
    ],
    floatUnitIds:    [288],
    issUnitIds:      [296],
    leaveUnitIds:    [290, 457, 293],
    nonRatioUnitIds: [281, 282, 287, 289, 429, 297, 313, 336],
  },
  {
    id: 'shell-cove', name: 'Shell Cove',
    approvedPlaces: 142,
    rooms: [
      { id: 'sc_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 349, ownaRoomName: 'Explorers 0-1' },
      { id: 'sc_1_2',  name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 350, ownaRoomName: 'Adventurers 1-2' },
      { id: 'sc_2_3a', name: '2-3 Pioneers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 351, ownaRoomName: '1 Pioneers 2-3' },
      { id: 'sc_2_3b', name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 352, ownaRoomName: '2 Voyagers 2-3' },
      { id: 'sc_3_4a', name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 353, ownaRoomName: 'Creators 3-4' },
      { id: 'sc_3_4b', name: '3-4 Dreamers',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 430, ownaRoomName: 'Dreamers 3-4' },
      { id: 'sc_4_5a', name: '4-5 Achievers',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 354, ownaRoomName: 'Achievers 4-5' },
      { id: 'sc_4_5b', name: '4-5 Inventors',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 431, ownaRoomName: 'Inventors 4-5' },
    ],
    floatUnitIds:    [355],
    issUnitIds:      [348],
    leaveUnitIds:    [440, 458, 359],
    nonRatioUnitIds: [343, 344, 345, 346, 347, 357, 358, 356],
  },
  {
    id: 'bexley', name: 'Bexley',
    approvedPlaces: 92,
    rooms: [
      room('bx_0_2',  '0-2 Explorers',   '0-2 yrs', 4,  113, '0-2'),
      room('bx_2_3',  '2-3 Adventurers', '2-3 yrs', 5,  125, '2-3'),
      { id: 'bx_3_4a', name: '3-4 Voyagers',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 115, ownaRoomName: '3-4 Room 1' },
      { id: 'bx_3_4b', name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 121, ownaRoomName: '3-4 Room 2' },
      room('bx_4_5',  '4-5 Achievers',   '4-5 yrs', 10, 114, '4-5'),
    ],
    floatUnitIds:    [181],
    issUnitIds:      [226],
    leaveUnitIds:    [446, 451, 195],
    nonRatioUnitIds: [111, 112, 216, 164, 305, 318, 330, 232],
  },
  {
    id: 'belfield', name: 'Belfield',
    approvedPlaces: 120,
    rooms: [
      { id: 'bf_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 383, ownaRoomName: '0-1 Explorers' },
      { id: 'bf_1_2',  name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 384, ownaRoomName: '1-2 Adventurers' },
      { id: 'bf_2_3a', name: '2-3 Pioneers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 385, ownaRoomName: '2-3 Pioneers' },
      { id: 'bf_2_3b', name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 386, ownaRoomName: '2-3 Voyagers' },
      { id: 'bf_3_4',  name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 387, ownaRoomName: '3-4 Creators' },
      { id: 'bf_4_5a', name: '4-5 Achievers',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 388, ownaRoomName: '4-5 Achievers' },
      { id: 'bf_4_5b', name: '4-5 Inventors',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 439, ownaRoomName: '4-5 Inventors' },
    ],
    floatUnitIds:    [389],
    issUnitIds:      [382],
    leaveUnitIds:    [445, 450, 393],
    nonRatioUnitIds: [377, 378, 379, 380, 381, 390, 391, 392],
  },
  {
    id: 'bankstown', name: 'Bankstown',
    approvedPlaces: 58,
    rooms: [
      { id: 'bk_0_2', name: '0-2 Explorers', ageGroup: '0-2 yrs', ratio: 4,  deputyUnitId: 417, ownaRoomName: '0-2 Explorers' },
      { id: 'bk_2_3', name: '2-3 Voyagers',  ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 420, ownaRoomName: '2-3 Voyagers' },
      { id: 'bk_3_5', name: '3-5 Achievers', ageGroup: '3-5 yrs', ratio: 10, deputyUnitId: 422, ownaRoomName: '3-5 Achievers' },
    ],
    floatUnitIds:    [423],
    issUnitIds:      [416],
    leaveUnitIds:    [444, 449, 427],
    nonRatioUnitIds: [411, 412, 413, 414, 415, 425, 424],
  },
  {
    id: 'glendale', name: 'Glendale',
    approvedPlaces: 90,
    rooms: [
      { id: 'gl_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 466, ownaRoomName: 'Explorers' },
      { id: 'gl_1_2',  name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 467, ownaRoomName: 'Adventurers' },
      { id: 'gl_2_3',  name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 468, ownaRoomName: 'Voyagers' },
      { id: 'gl_3_4a', name: '3-4 Pioneers',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 469, ownaRoomName: 'Pioneers' },
      { id: 'gl_3_4b', name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 470, ownaRoomName: 'Creators' },
      { id: 'gl_4_5',  name: '4-5 Achievers',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 471, ownaRoomName: 'Achievers' },
    ],
    floatUnitIds:    [473],
    issUnitIds:      [465],
    leaveUnitIds:    [476, 477, 475],
    nonRatioUnitIds: [461, 462, 463, 464, 479, 478, 474],
  },
  {
    id: 'edgeworth', name: 'Edgeworth',
    approvedPlaces: 144,
    rooms: [
      { id: 'ew_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 400, ownaRoomName: '0-1 Explorers' },
      { id: 'ew_1_2',  name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 401, ownaRoomName: '1-2 Adventurers' },
      { id: 'ew_2_3a', name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 403, ownaRoomName: '2-3 Voyagers' },
      { id: 'ew_2_3b', name: '2-3 Wonderlings', ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 435, ownaRoomName: '2-3 Wonderlings' },
      { id: 'ew_3_4a', name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 404, ownaRoomName: '3-4 Creators' },
      { id: 'ew_3_4b', name: '3-4 Dreamers',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 436, ownaRoomName: '3-4 Dreamers' },
      { id: 'ew_4_5a', name: '4-5 Achievers',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 402, ownaRoomName: '4-5 Achievers' },
      { id: 'ew_4_5b', name: '4-5 Inventors',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 405, ownaRoomName: '4-5 Inventors' },
    ],
    floatUnitIds:    [406],
    issUnitIds:      [399],
    leaveUnitIds:    [447, 453, 410],
    nonRatioUnitIds: [394, 395, 396, 397, 398, 407, 408, 409],
  },
  {
    id: 'charlestown', name: 'Charlestown',
    approvedPlaces: 122,
    rooms: [
      { id: 'ch_0_1',  name: '0-1 Explorers',   ageGroup: '0-1 yrs', ratio: 4,  deputyUnitId: 489, ownaRoomName: 'Explorers' },
      { id: 'ch_1_2',  name: '1-2 Adventurers', ageGroup: '1-2 yrs', ratio: 4,  deputyUnitId: 490, ownaRoomName: 'Adventurers' },
      { id: 'ch_2_3a', name: '2-3 Voyagers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 491, ownaRoomName: 'Voyagers' },
      { id: 'ch_2_3b', name: '2-3 Pioneers',    ageGroup: '2-3 yrs', ratio: 5,  deputyUnitId: 492, ownaRoomName: 'Pioneers' },
      { id: 'ch_3_4',  name: '3-4 Creators',    ageGroup: '3-4 yrs', ratio: 10, deputyUnitId: 493, ownaRoomName: 'Creators' },
      { id: 'ch_4_5a', name: '4-5 Inventors',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 495, ownaRoomName: 'Inventors' },
      { id: 'ch_4_5b', name: '4-5 Achievers',   ageGroup: '4-5 yrs', ratio: 10, deputyUnitId: 494, ownaRoomName: 'Achievers' },
    ],
    floatUnitIds:    [496],
    issUnitIds:      [488],
    leaveUnitIds:    [501, 502, 500],
    nonRatioUnitIds: [483, 484, 485, 486, 487, 497, 498, 499],
    outdoorAreas:    ['Outdoor Area Level 1', 'Outdoor Area Level 2'],
  },
];

export const USERS: User[] = [
  { email: 'matt@tga.edu.au',           role: 'admin',    centreId: null as unknown as string, name: 'Matt' },
  { email: 'oatley@tga.edu.au',         role: 'director', centreId: 'oatley',           name: 'Oatley' },
  { email: 'wollongong@tga.edu.au',     role: 'director', centreId: 'wollongong',       name: 'Wollongong' },
  { email: 'mountannan@tga.edu.au',     role: 'director', centreId: 'mount-annan',      name: 'Mount Annan' },
  { email: 'springfarm@tga.edu.au',     role: 'director', centreId: 'spring-farm',      name: 'Spring Farm' },
  { email: 'denhamcourt@tga.edu.au',    role: 'director', centreId: 'denham-court',     name: 'Denham Court' },
  { email: 'edpark1@tga.edu.au',        role: 'director', centreId: 'ed-park-1',        name: 'Ed Park 1' },
  { email: 'edpark2@tga.edu.au',        role: 'director', centreId: 'ed-park-2',        name: 'Ed Park 2' },
  { email: 'wilton@tga.edu.au',         role: 'director', centreId: 'wilton',           name: 'Wilton' },
  { email: 'dapto1@tga.edu.au',         role: 'director', centreId: 'dapto-1',          name: 'Dapto 1' },
  { email: 'dapto2@tga.edu.au',         role: 'director', centreId: 'dapto-2',          name: 'Dapto 2' },
  { email: 'northwollongong@tga.edu.au',role: 'director', centreId: 'north-wollongong', name: 'North Wollongong' },
  { email: 'shellcove@tga.edu.au',      role: 'director', centreId: 'shell-cove',       name: 'Shell Cove' },
  { email: 'bexley@tga.edu.au',         role: 'director', centreId: 'bexley',           name: 'Bexley' },
  { email: 'belfield@tga.edu.au',       role: 'director', centreId: 'belfield',         name: 'Belfield' },
  { email: 'bankstown@tga.edu.au',      role: 'director', centreId: 'bankstown',        name: 'Bankstown' },
  { email: 'glendale@tga.edu.au',       role: 'director', centreId: 'glendale',         name: 'Glendale' },
  { email: 'edgeworth@tga.edu.au',      role: 'director', centreId: 'edgeworth',        name: 'Edgeworth' },
  { email: 'charlestown@tga.edu.au',    role: 'director', centreId: 'charlestown',      name: 'Charlestown' },
];

export const PASSWORDS: Record<string, string> = {
  'matt@tga.edu.au':            'admin123',
  'oatley@tga.edu.au':          'oatley2026',
  'wollongong@tga.edu.au':      'wollongong2026',
  'mountannan@tga.edu.au':      'mountannan2026',
  'springfarm@tga.edu.au':      'springfarm2026',
  'denhamcourt@tga.edu.au':     'denhamcourt2026',
  'edpark1@tga.edu.au':         'edpark12026',
  'edpark2@tga.edu.au':         'edpark22026',
  'wilton@tga.edu.au':          'wilton2026',
  'dapto1@tga.edu.au':          'dapto12026',
  'dapto2@tga.edu.au':          'dapto22026',
  'northwollongong@tga.edu.au': 'northwollongong2026',
  'shellcove@tga.edu.au':       'shellcove2026',
  'bexley@tga.edu.au':          'bexley2026',
  'belfield@tga.edu.au':        'belfield2026',
  'bankstown@tga.edu.au':       'bankstown2026',
  'glendale@tga.edu.au':        'glendale2026',
  'edgeworth@tga.edu.au':       'edgeworth2026',
  'charlestown@tga.edu.au':     'charlestown2026',
};


export const SUPABASE_URL  = 'https://tgxpvzlibquqnldgmwho.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDE3MjUsImV4cCI6MjA4OTUxNzcyNX0.v_thHOU7xq0gaFhcnb2A3iBl5H7bAp9IbT9IPMg_jTY';

// Kept for legacy DayDetailPage reference
export const LUNCH_WINDOW = { start: '11:30', end: '14:00' };

// Kept for legacy attendance.ts reference
export const DEFAULT_ATTENDANCE: Record<string, number> = {};

export const WOLLONGONG_FLOAT_UNIT_IDS    = [126];
export const WOLLONGONG_LEAVE_UNIT_IDS    = [128, 460];
export const WOLLONGONG_NONRATIO_UNIT_IDS = [116, 117, 124, 166, 202, 231, 312, 326, 339];


