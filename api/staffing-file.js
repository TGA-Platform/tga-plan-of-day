/**
 * /api/staffing-file?url=<encoded-monday-url>
 * Proxies a Monday.com protected file using the Monday API key,
 * streaming it back to the browser so it can be previewed inline.
 */

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Only allow monday.com URLs
  let decoded;
  try {
    decoded = decodeURIComponent(url);
    const u = new URL(decoded);
    if (!u.hostname.endsWith('.monday.com')) {
      return res.status(403).json({ error: 'Only monday.com URLs allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const upstream = await fetch(decoded, {
      headers: {
        Authorization: MONDAY_API_KEY || '',
        // Monday protected_static files need the cookie-less auth token approach
        // The Authorization header works for API calls but not static files.
        // Use a direct fetch — Monday protected_static URLs are time-limited signed URLs
        // that don't need auth if fetched server-side within the validity window.
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    // Force inline display — override any attachment disposition
    res.setHeader('Content-Disposition', 'inline');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    // Cache for 10 minutes
    res.setHeader('Cache-Control', 'private, max-age=600');

    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('staffing-file proxy error:', err);
    res.status(500).json({ error: err.message });
  }
}
