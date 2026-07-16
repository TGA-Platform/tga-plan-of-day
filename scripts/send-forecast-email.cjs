/**
 * Local sender for the staffing forecast email.
 *
 * Vercel serverless functions block outbound SMTP, so the API
 * (/api/staffing-forecast-email) only generates the emails. This script
 * fetches the generated emails and sends them via Office 365 SMTP.
 *
 * Usage:
 *   SMTP_PASS=... node scripts/send-forecast-email.cjs
 *   SMTP_PASS=... DATE=2026-07-17 node scripts/send-forecast-email.cjs
 *   SMTP_PASS=... INCLUDE_CLUSTERS=false node scripts/send-forecast-email.cjs
 */

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || 'claude@tga.edu.au';
const SMTP_PASS = process.env.SMTP_PASS;
const DATE = process.env.DATE || new Date().toISOString().slice(0, 10);
const PREVIEW_URL = process.env.PREVIEW_URL || 'https://plan.tga.edu.au';
const INCLUDE_CLUSTERS = process.env.INCLUDE_CLUSTERS !== 'false';

if (!SMTP_PASS) {
  console.error('Set SMTP_PASS env var');
  process.exit(1);
}

async function main() {
  const params = new URLSearchParams({ date: DATE });
  if (!INCLUDE_CLUSTERS) params.set('clusters', '0');

  const res = await fetch(`${PREVIEW_URL}/api/staffing-forecast-email?${params.toString()}`);
  if (!res.ok) throw new Error(`Forecast API ${res.status}: ${await res.text()}`);
  const data = await res.json();

  if (!Array.isArray(data.emails) || data.emails.length === 0) {
    console.log('No emails to send');
    process.exit(0);
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

  const results = [];
  for (const email of data.emails) {
    const info = await transporter.sendMail({
      from: `"TGA Plan of Day" <${SMTP_USER}>`,
      to: email.to.join(', '),
      subject: email.subject,
      html: email.html,
    });
    results.push({ to: email.to, subject: email.subject, messageId: info.messageId });
    console.log('Sent:', email.subject, '→', info.messageId);
  }

  console.log('Done. Total emails sent:', results.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
