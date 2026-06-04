const fs = require('fs');
const file = 'src/config.ts';
let c = fs.readFileSync(file, 'utf8');

// Map: [floatId, issId] per centre — from our Deputy query
const splits = [
  { centre: 'oatley',          float: [224],  iss: [230]  },
  { centre: 'wollongong',      float: [126],  iss: [231]  },
  { centre: 'mount-annan',     float: [222],  iss: [225]  },
  { centre: 'spring-farm',     float: [270],  iss: [278]  },
  { centre: 'denham-court',    float: [252],  iss: [260]  },
  { centre: 'ed-park-1',       float: [207],  iss: [228]  },
  { centre: 'ed-park-2',       float: [220],  iss: [229]  },
  { centre: 'wilton',          float: [372],  iss: [365]  },
  { centre: 'dapto-1',         float: [205],  iss: [233]  },
  { centre: 'dapto-2',         float: [206],  iss: [227]  },
  { centre: 'north-wollongong',float: [288],  iss: [296]  },
  { centre: 'shell-cove',      float: [355],  iss: [348]  },
  { centre: 'bexley',          float: [181],  iss: [226]  },
  { centre: 'belfield',        float: [389],  iss: [382]  },
  { centre: 'bankstown',       float: [423],  iss: [416]  },
  { centre: 'glendale',        float: [473],  iss: [465]  },
  { centre: 'edgeworth',       float: [406],  iss: [399]  },
];

let changed = 0;
for (const { float, iss } of splits) {
  const combined = [...float, ...iss].sort((a,b) => a-b);
  const allVariants = [
    [combined[0], combined[1]],
    [combined[1], combined[0]],
  ];
  for (const [a, b] of allVariants) {
    const oldStr = `floatUnitIds:    [${a}, ${b}]`;
    const newStr = `floatUnitIds:    [${float[0]}],\n    issUnitIds:      [${iss[0]}]`;
    if (c.includes(oldStr)) {
      c = c.replace(oldStr, newStr);
      changed++;
      break;
    }
  }
}

// Handle Oatley's special comment case: "Float Staff + ISS"
c = c.replace(
  `floatUnitIds:    [224, 230],      // Float Staff + ISS`,
  `floatUnitIds:    [224],           // Float Staff\n    issUnitIds:      [230],           // ISS`
);

fs.writeFileSync(file, c, 'utf8');
console.log(`Updated ${changed} centres. File size: ${c.length}`);

// Verify
const remaining = (c.match(/floatUnitIds:\s*\[\d+, \d+\]/g) || []);
if (remaining.length > 0) {
  console.log('⚠️  Still has paired floatUnitIds:', remaining);
} else {
  console.log('✓ All floatUnitIds are now single-entry');
}
console.log('issUnitIds count:', (c.match(/issUnitIds/g) || []).length);
