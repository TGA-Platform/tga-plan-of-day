/**
 * /api/staffing-upload
 *
 * POST multipart/form-data → upload file to Supabase Storage + create staff_documents record
 *
 * Body:
 *   staff_id      (required)
 *   label         (required) — e.g. "WWC", "First Aid", "Qualification Certificate"
 *   doc_type      (optional) — "main" | "subitem" (default "subitem")
 *   file          (required) — binary file
 *
 * Returns: { id, storage_path, file_name, mime_type }
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const BUCKET = 'staff-documents';

function safeName(str) {
  return str.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Parse multipart form data
    const formidable = (await import('formidable')).default;
    const form = formidable({ multiples: false, maxFileSize: 20 * 1024 * 1024 }); // 20MB

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const staffId = Array.isArray(fields.staff_id) ? fields.staff_id[0] : fields.staff_id;
    const label = Array.isArray(fields.label) ? fields.label[0] : fields.label;
    const docType = (Array.isArray(fields.doc_type) ? fields.doc_type[0] : fields.doc_type) || 'subitem';
    const file = files.file;

    if (!staffId || !label || !file) {
      return res.status(400).json({ error: 'staff_id, label, and file are required' });
    }

    const fileObj = Array.isArray(file) ? file[0] : file;
    const buffer = await require('fs').promises.readFile(fileObj.filepath);
    const origName = fileObj.originalFilename || 'file';
    const ext = require('path').extname(origName) || '';
    const mimeType = fileObj.mimetype || 'application/octet-stream';

    // Get centre_id from staff record
    const staffRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff_members?id=eq.${staffId}&select=centre_id&limit=1`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } }
    );
    const staffData = await staffRes.json();
    const centreId = staffData[0]?.centre_id || 'unknown';

    // Build storage path
    const storagePath = `${centreId}/${staffId}/${safeName(label)}_${Date.now()}${ext}`;

    // Upload to Supabase Storage
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      throw new Error(`Storage upload failed (${uploadRes.status}): ${t}`);
    }

    // Insert staff_documents record
    const docRecord = {
      staff_id: staffId,
      label: label,
      doc_type: docType,
      storage_path: storagePath,
      file_name: origName,
      mime_type: mimeType,
    };

    const docRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff_documents`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(docRecord),
      }
    );

    if (!docRes.ok) {
      const t = await docRes.text();
      throw new Error(`Database insert failed (${docRes.status}): ${t}`);
    }

    const inserted = await docRes.json();

    return res.status(200).json({
      id: inserted[0]?.id,
      storage_path: storagePath,
      file_name: origName,
      mime_type: mimeType,
      url: `/api/staffing-file?path=${encodeURIComponent(storagePath)}`,
    });

  } catch (err) {
    console.error('staffing-upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
