const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || 'claude@tga.edu.au';
const SMTP_PASS = process.env.SMTP_PASS;
const TO = process.env.TO;
const DATE = process.env.DATE || new Date().toISOString().slice(0, 10);
const PREVIEW_URL = process.env.PREVIEW_URL || 'https://tga-plan-of-3jf7gs400-matthew-maleks-projects.vercel.app';

if (!SMTP_PASS) {
  console.error('Set SMTP_PASS env var');
  process.exit(1);
}
if (!TO) {
  console.error('Set TO env var');
  process.exit(1);
}

async function main() {
  const res = await fetch(`${PREVIEW_URL}/api/staffing-forecast-email?date=${DATE}`);
  if (!res.ok) throw new Error(`Forecast API ${res.status}: ${await res.text()}`);
  const data = await res.json();

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

  const info = await transporter.sendMail({
    from: `"TGA Plan of Day" <${SMTP_USER}>`,
    to: TO,
    subject: `TGA Staffing Forecast - ${data.date}`,
    html: data.html,
  });

  console.log('Sent:', info.messageId);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
