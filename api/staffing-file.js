/**
 * /api/staffing-file?path=<storage-path>
 * Generates a short-lived signed URL from Supabase Storage and redirects to it,
 * OR streams files directly for inline preview (PDFs, images).
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';
const BUCKET = 'staff-documents';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path: storagePath } = req.query;
  if (!storagePath) return res.status(400).json({ error: 'path required' });

  try {
    // Generate a 1-hour signed URL from Supabase Storage
    const r = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${storagePath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      }
    );

    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Storage sign failed (${r.status}): ${t}`);
    }

    const { signedURL } = await r.json();
    const fullUrl = `${SUPABASE_URL}/storage/v1${signedURL}`;

    // Fetch the file and stream it inline (forces browser preview instead of download)
    const file = await fetch(fullUrl);
    if (!file.ok) throw new Error(`File fetch failed: ${file.status}`);

    const contentType = file.headers.get('content-type') || 'application/octet-stream';
    const buffer = await file.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('staffing-file error:', err);
    return res.status(500).json({ error: err.message });
  }
}
