/**
 * Download all Belfield documents from Monday.com to Supabase Storage
 * This script handles docs that have Monday URLs but no storage_path
 */

const https = require('https');
const path = require('path');

const MONDAY_TOKEN = 'eyJhbG…mXq4';
const MONDAY_URL = 'https://api.monday.com/v2';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const BUCKET = 'staff-documents';
const SB = `${SUPABASE_URL}/rest/v1`;
const SB_HEADERS = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
};

// ── Monday API ─────────────────────────────────────────────────────────────

async function mondayQuery(query) {
  const r = await fetch(MONDAY_URL, {
    method: 'POST',
    headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-01' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`Monday API ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0]?.message);
  return j.data;
}

// ── Supabase helpers ───────────────────────────────────────────────────────

async function sbGet(path) {
  const r = await fetch(`${SB}${path}`, { headers: SB_HEADERS });
  if (!r.ok) { const t = await r.text(); throw new Error(`SB GET failed: ${t}`); }
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${SB}${path}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`SB PATCH failed: ${t}`); }
  return r.json();
}

// ── File download ──────────────────────────────────────────────────────────

function extractAssetId(url) {
  const m = url.match(/\/resources\/(\d+)\//);
  return m ? m[1] : null;
}

const assetUrlCache = new Map();
async function getAssetPublicUrl(assetId) {
  if (assetUrlCache.has(assetId)) return assetUrlCache.get(assetId);
  const data = await mondayQuery(`{ assets(ids: [${assetId}]) { id public_url } }`);
  const url = data?.assets?.[0]?.public_url || null;
  assetUrlCache.set(assetId, url);
  return url;
}

async function downloadFile(mondayUrl) {
  const assetId = extractAssetId(mondayUrl);
  let downloadUrl = mondayUrl;
  if (assetId) {
    const publicUrl = await getAssetPublicUrl(assetId);
    if (publicUrl) downloadUrl = publicUrl;
  }
  const r = await fetch(downloadUrl);
  if (!r.ok) throw new Error(`Download failed ${r.status}: ${downloadUrl}`);
  const buffer = await r.arrayBuffer();
  const mime = r.headers.get('content-type') || 'application/octet-stream';
  return { buffer: Buffer.from(buffer), mime };
}

async function uploadToStorage(storagePath, buffer, mimeType) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  const text = await r.text();
  if (!r.ok && !text.includes('already exists') && !text.includes('Duplicate')) {
    throw new Error(`Storage upload failed (${r.status}): ${text}`);
  }
  return storagePath;
}

function safeName(str) {
  return str.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching Belfield staff documents...\n');

  // Get all Belfield staff
  const staff = await sbGet('/staff_members?centre_id=eq.belfield');
  const staffIds = staff.map(s => s.id);
  console.log(`Found ${staff.length} staff members`);

  // Get all documents for these staff
  const allDocs = await sbGet(`/staff_documents?staff_id=in.(${staffIds.join(',')})&limit=1000`);
  console.log(`Found ${allDocs.length} document records`);

  // Filter to docs without storage_path (need downloading)
  const needDownload = allDocs.filter(d => !d.storage_path && d.monday_url);
  console.log(`Documents needing download: ${needDownload.length}\n`);

  if (needDownload.length === 0) {
    console.log('All documents already downloaded!');
    return;
  }

  let downloaded = 0, failed = 0;

  for (let i = 0; i < needDownload.length; i++) {
    const doc = needDownload[i];
    const staffMember = staff.find(s => s.id === doc.staff_id);
    const staffName = staffMember?.name || 'Unknown';

    process.stdout.write(`[${i+1}/${needDownload.length}] ${staffName} - ${doc.label}... `);

    try {
      // Download from Monday
      const { buffer, mime } = await downloadFile(doc.monday_url);

      // Derive storage path
      const urlPath = new URL(doc.monday_url).pathname;
      const origName = decodeURIComponent(urlPath.split('/').pop() || 'file');
      const ext = path.extname(origName) || '';
      const storagePath = `belfield/${doc.staff_id}/${safeName(doc.label)}_${safeName(origName)}`;

      // Upload to Supabase Storage
      await uploadToStorage(storagePath, buffer, mime);

      // Update the document record with storage_path
      await sbPatch(`/staff_documents?id=eq.${doc.id}`, {
        storage_path: storagePath,
        file_name: path.basename(storagePath),
        mime_type: mime,
      });

      downloaded++;
      console.log('OK');
    } catch (e) {
      failed++;
      console.log(`FAILED: ${e.message}`);
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nDone: ${downloaded} downloaded, ${failed} failed`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
