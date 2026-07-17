/**
 * Local sender for the staffing forecast email.
 *
 * Vercel serverless functions block outbound SMTP, so the API
 * (/api/staffing-forecast-email) only generates the email HTML. This script
 * fetches the generated email and sends it via Office 365 SMTP.
 *
 * Usage:
 *   SMTP_PASS=... node scripts/send-forecast-email.cjs
 *   SMTP_PASS=... DATE=2026-07-18 node scripts/send-forecast-email.cjs
 *   SMTP_PASS=... PREVIEW_URL=https://plan.tga.edu.au node scripts/send-forecast-email.cjs
 *
 * Recipients are set via env vars TO, CC, BCC (comma-separated).
 * Defaults are the centre directors + area managers + summary recipients from MEMORY.md.
 */

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || 'claude@tga.edu.au';
const SMTP_PASS = process.env.SMTP_PASS;
const DATE = process.env.DATE || new Date().toISOString().slice(0, 10);
const PREVIEW_URL = process.env.PREVIEW_URL || 'https://plan.tga.edu.au';

function parseEmails(envVar) {
  if (!envVar) return [];
  return envVar.split(',').map(s => s.trim()).filter(Boolean);
}

// Default recipient list from MEMORY.md staffing forecast section.
// Override with TO=..., CC=..., BCC=... env vars.
const DEFAULT_TO = [
  'sarah.campbell@tga.edu.au',   // Mount Annan
  'emma@tga.edu.au',             // North Wollongong
  'tayla@tga.edu.au',            // Oatley
  'matthew@tga.edu.au',          // overall summary
  'kerry@tga.edu.au',            // overall summary
];

const DEFAULT_CC = [
  'lilian@tga.edu.au',           // South West / Mount Annan
  'rebeccasapienza@tga.edu.au',  // South Coast / North Wollongong
  'olivia@tga.edu.au',           // South Sydney / Oatley
  'paige@tga.edu.au',            // cluster AMs
  'kerry@tga.edu.au',            // cluster AMs
];

const TO = parseEmails(process.env.TO).length > 0 ? parseEmails(process.env.TO) : DEFAULT_TO;
const CC = parseEmails(process.env.CC).length > 0 ? parseEmails(process.env.CC) : DEFAULT_CC;
const BCC = parseEmails(process.env.BCC);

if (!SMTP_PASS) {
  console.error('Set SMTP_PASS env var');
  process.exit(1);
}

async function main() {
  const url = `${PREVIEW_URL}/api/staffing-forecast-email?date=${DATE}`;
  console.log('Fetching:', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Forecast API ${res.status}: ${await res.text()}`);
  const data = await res.json();

  if (!data.html) {
    console.error('API did not return HTML');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      ciphers: 'SSLv3',
    },
  });

  const mailOptions = {
    from: `"TGA Plan of Day" <${SMTP_USER}>`,
    to: TO.join(', '),
    cc: CC.length > 0 ? CC.join(', ') : undefined,
    bcc: BCC.length > 0 ? BCC.join(', ') : undefined,
    subject: `TGA Staffing Forecast - ${data.date}`,
    html: data.html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('Sent:', info.messageId);
  console.log('To:', TO.join(', '));
  console.log('CC:', CC.join(', '));
  if (BCC.length > 0) console.log('BCC:', BCC.join(', '));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
