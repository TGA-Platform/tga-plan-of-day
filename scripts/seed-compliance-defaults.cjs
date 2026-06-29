const https = require('https');
const host = 'tga-plan-of-36tbrj81v-matthew-maleks-projects.vercel.app';

const defaults = [
  {"id":"wwcc","label":"Working with Children Check","category":"certification","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator","Trainee","Centre Support","Chef","ISS Support Worker"],"expiryField":"wwcc_expiry","isMandatory":true,"description":"Valid WWCC required for all staff working with children"},
  {"id":"first_aid","label":"First Aid Certificate","category":"certification","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator"],"expiryField":"first_aid_expiry","isMandatory":true,"description":"HLTAID011 or equivalent"},
  {"id":"cpr","label":"CPR Certificate","category":"certification","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator"],"expiryField":"cpr_expiry","isMandatory":true,"description":"Current CPR certification"},
  {"id":"anaphylaxis","label":"Anaphylaxis Training","category":"certification","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator"],"expiryField":"anaphylaxis_expiry","isMandatory":true,"description":"22300VIC or equivalent"},
  {"id":"child_protection","label":"Child Protection Training","category":"certification","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator","Trainee"],"expiryField":"child_protection_renewal","isMandatory":true,"description":"Annual refresher required"},
  {"id":"food_handling","label":"Food Handling Certificate","category":"certification","requiredFor":["Chef","Centre Director","Assistant Director"],"isMandatory":true,"description":"Required for staff handling food"},
  {"id":"fire_warden","label":"Fire Warden Training","category":"certification","requiredFor":["Centre Director","Assistant Director","Educational Leader"],"isMandatory":false,"description":"Recommended for leadership team"},
  {"id":"qualification_cert","label":"Qualification Certificate","category":"document","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator","Trainee"],"docPattern":"qualification|transcript|award","isMandatory":true,"description":"Cert III, Diploma, or ECT qualification"},
  {"id":"induction","label":"Induction Checklist","category":"document","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator","Trainee","Centre Support","Chef","ISS Support Worker"],"docPattern":"induction","isMandatory":true,"description":"Completed centre induction"},
  {"id":"policy_kit","label":"Policy Kit Signed","category":"document","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator","Trainee","Centre Support","Chef","ISS Support Worker"],"docPattern":"policy","isMandatory":true,"description":"Signed acknowledgement of policies"},
  {"id":"staff_record","label":"Staff Record","category":"document","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator","Trainee","Centre Support","Chef","ISS Support Worker"],"docPattern":"staff.?record","isMandatory":true,"description":"Complete staff record form"},
  {"id":"job_description","label":"Job Description","category":"document","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator","Trainee","Centre Support","Chef","ISS Support Worker"],"docPattern":"job.?desc|position.?desc","isMandatory":true,"description":"Signed position description"},
  {"id":"employment_contract","label":"Employment Contract","category":"document","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher","Educator","Trainee","Centre Support","Chef","ISS Support Worker"],"docPattern":"employment|contract","isMandatory":true,"description":"Signed employment agreement"},
  {"id":"key_responsibilities","label":"Key Responsibilities","category":"document","requiredFor":["Centre Director","Assistant Director","Educational Leader","Room Leader","Early Childhood Teacher"],"docPattern":"responsib","isMandatory":false,"description":"Signed key responsibilities document"},
  {"id":"training_contract","label":"Training Contract","category":"document","requiredFor":["Trainee"],"docPattern":"training.?contract","isMandatory":true,"description":"Registered training contract"},
  {"id":"training_plan","label":"Training Plan","category":"document","requiredFor":["Trainee"],"docPattern":"training.?plan","isMandatory":true,"description":"Formal training plan"},
  {"id":"rp_consent","label":"RP/NS/EL Consent","category":"document","requiredFor":["Room Leader","Early Childhood Teacher","Educational Leader"],"docPattern":"consent","isMandatory":true,"description":"Responsible Person / Nominated Supervisor consent"}
];

const body = JSON.stringify({ requirements: defaults });
const req = https.request({
  hostname: host,
  path: '/api/compliance-requirements',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => console.log(r.statusCode, d));
});
req.write(body); req.end();
