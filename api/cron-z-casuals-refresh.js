/**
 * Cron job: refresh Z Staffing external casuals for all TGA centres.
 * Run every 5 minutes. Fetches live from Z API and caches in Supabase z_casuals.
 * Caches the past 7 days plus the next 6 days so historical dates still load.
 */

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRneHB2emxpYnF1cW5sZGdtd2hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk0MTcyNSwiZXhwIjoyMDg5NTE3NzI1fQ.oDIv1ilQ3KiaCFnngllZcfEhv-9W0BJ8nFMyXyS6f1c';

const Z_COGNITO_REGION = 'ap-southeast-2';
const Z_CLIENT_ID      = '4brth3dn73p47s17m5p28lvi2r';
const Z_GRAPHQL_URL    = 'https://api.zrecruitment.com.au/graphql';

const TGA_WORKSPACE_MAP = {
  'Wollongong':         '804b217a-e60f-7e4c-51bb-9c0cb1efb06b',
  'Shell Cove':         'bd16a8c7-77f9-1d9e-db48-2770c926a206',
  'Belfield':           '5c6abdc2-9566-87aa-e6bf-d55c64ae8524',
  'Edgeworth':          '7acb51fe-02fb-8020-6eb1-c360caf57d88',
  'Dapto':              'defc8724-7e8d-228d-81e9-e6e23e247819',
  'Dapto 2':            '4e7b8c0c-509a-879b-eeb0-2e503da86e66',
  'Edmondson Park 1':   '6c452302-7759-8caa-469d-dda75808d208',
  'Edmondson Park 2':   '5de49c78-cd5a-887c-94f8-42bda0cc709d',
  'Oatley':             'e37f4e67-16c4-0252-537e-d8698179413d',
  'Mount Annan':        '720ee944-cf15-1755-a59d-15c3dee8fddd',
  'North Wollongong':   'dce8d817-b516-9287-4edd-733356a72813',
  'Bexley':             'a777b110-9fe9-d477-8c18-6e9daf5357d3',
  'Spring Farm':        '0dbc3f77-9d43-e522-4765-aa6a97e00876',
  'Denham Court':       '9285c534-12ab-31c1-401a-3cdda30a5b40',
  'Wilton':             '53b9a960-c404-36ae-e6e2-f44b25303680',
  'Glendale':           '2277a625-9403-b30a-3315-be19ab6c922a',
};

let _tokenCache = null;

async function getIdToken() {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt - now > 5 * 60 * 1000) {
    return _tokenCache.idToken;
  }

  const refreshToken = process.env.Z_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('Z_REFRESH_TOKEN env var not set');

  const resp = await fetch(`https://cognito-idp.${Z_COGNITO_REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: Z_CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: process.env.Z_REFRESH_TOKEN },
    }),
  });

  const data = await resp.json();
  if (!data.AuthenticationResult) {
    throw new Error(`Z Staffing auth failed: ${JSON.stringify(data)}`);
  }

  const idToken   = data.AuthenticationResult.IdToken;
  const expiresIn = data.AuthenticationResult.ExpiresIn ?? 3600;
  _tokenCache = { idToken, expiresAt: now + expiresIn * 1000 };
  return idToken;
}

async function getAuthToken() {
  if (process.env.Z_API_KEY_ENABLED === 'true' && process.env.Z_API_KEY) {
    return { token: process.env.Z_API_KEY, source: 'api-key' };
  }
  const idToken = await getIdToken();
  return { token: idToken, source: 'cognito' };
}

async function queryZGraphQL(authToken, query, variables = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken.source === 'api-key') {
    headers['Authorization'] = 'API_KEY ' + authToken.token;
  } else {
    headers['Authorization'] = 'COGNITO ' + authToken.token;
  }

  const resp = await fetch(Z_GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ operationName: null, query, variables }),
  });
  const data = await resp.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

function epochToTime(ms) {
  return new Date(parseInt(ms)).toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function parseStatus(raw) {
  if (!raw) return 'Unknown';
  return raw.split('|')[0];
}

function hhmmToMins(t) {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Compute paid hours from Z's fields: prefer totalHours, otherwise duration minus break. */
function paidHoursFromJob(j) {
  const totalHours = Number(j.totalHours);
  if (totalHours > 0) return totalHours;
  const startMs = parseInt(j.startDate);
  const endMs = parseInt(j.endDate);
  if (!startMs || !endMs || endMs <= startMs) return 0;
  const durationHrs = (endMs - startMs) / 3600000;
  const breakMins = Number(j.finalBreakDuration ?? j.breakDuration ?? 0);
  const breakHrs = Math.max(0, Math.min(breakMins / 60, durationHrs));
  return durationHrs - breakHrs;
}

async function upsertToSupabase(rows) {
  if (!rows.length) return;
  // Use z_job_id as the conflict target so existing rows are updated.
  const url = `${SUPABASE_URL}/rest/v1/z_casuals?on_conflict=z_job_id`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    console.error('[cron-z-casuals] Supabase upsert failed:', resp.status, txt);
  }
}

const JOB_QUERY = `
  query getAllJobInformationForWorkspace($workspaceId: String!, $withEducatorProfile: Boolean) {
    getAllJobInformationForWorkspace(workspaceId: $workspaceId, withEducatorProfile: $withEducatorProfile) {
      jobs {
        id
        workspaceId
        startDate
        endDate
        status
        isFilled
        isCompleted
        isDraft
        educatorUserId
        certificationLevel
        educatorCertificationLevel
        hourlyRateUsed
        totalHours
        breakDuration
        finalBreakDuration
        educatorProfile {
          givenName
          surname
          certificationLevel
        }
      }
    }
  }
`;

function dateToSydneyEpochMs(dateStr) {
  return new Date(`${dateStr}T00:00:00+10:00`).getTime();
}

function jobsForDate(allJobs, date) {
  const dayStart = dateToSydneyEpochMs(date);
  const dayEnd   = dayStart + 86400000;
  return allJobs.filter(j => {
    const s = parseInt(j.startDate);
    return s >= dayStart && s < dayEnd;
  });
}

async function fetchCentre(centre, dates, auth) {
  const workspaceId = TGA_WORKSPACE_MAP[centre];
  if (!workspaceId) return [];

  const gqlData = await queryZGraphQL(auth, JOB_QUERY, { workspaceId, withEducatorProfile: true });
  const allJobs = gqlData?.getAllJobInformationForWorkspace?.jobs ?? [];

  const rows = [];
  for (const date of dates) {
    const dayJobs = jobsForDate(allJobs, date)
      .filter(j => !j.isDraft)
      .map(j => {
        const profile  = j.educatorProfile;
        const name     = profile ? `${profile.givenName} ${profile.surname}`.trim() : null;
        const certLevel = j.educatorCertificationLevel || profile?.certificationLevel || j.certificationLevel || 'NONE';
        const fetchedRate = Number(j.hourlyRateUsed) || 0;
        const costCents = Math.round(fetchedRate * paidHoursFromJob(j));

        return {
          zJobId:      j.id,
          name:        name || null,
          start:       epochToTime(j.startDate),
          end:         epochToTime(j.endDate),
          status:      parseStatus(j.status),
          isFilled:    j.isFilled,
          certLevel,
          costCents,
          workspaceId: j.workspaceId,
        };
      })
      .filter(j => j.isFilled && j.name);

    for (const r of dayJobs) {
      rows.push({
        centre,
        date,
        z_job_id:     r.zJobId,
        name:         r.name,
        start_time:   r.start,
        end_time:     r.end,
        status:       r.status,
        cert_level:   r.certLevel,
        cost_cents:   r.costCents,
        workspace_id: r.workspaceId,
        fetched_at:   new Date().toISOString(),
      });
    }
  }

  return rows;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00+10:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

export default async function handler(req, res) {
  // Vercel cron sends GET; also allow explicit POST invocations
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const baseDate = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  const dates = [];
  for (let i = -7; i < 7; i++) {
    dates.push(addDays(baseDate, i));
  }

  try {
    const auth = await getAuthToken();
    const centres = Object.keys(TGA_WORKSPACE_MAP);
    const rows = [];

    // Fetch centres in parallel with limited concurrency
    const CONCURRENCY = 5;
    for (let i = 0; i < centres.length; i += CONCURRENCY) {
      const batch = centres.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async centre => {
          try {
            return await fetchCentre(centre, dates, auth);
          } catch (err) {
            console.error(`[cron-z-casuals] ${centre} failed:`, err.message);
            return [];
          }
        })
      );
      for (const r of results) rows.push(...r);
    }

    await upsertToSupabase(rows);
    console.log(`[cron-z-casuals] Refreshed ${rows.length} rows using ${auth.source}`);
    return res.status(200).json({ ok: true, dates, centres: centres.length, rows: rows.length });
  } catch (err) {
    console.error('[cron-z-casuals] Fatal:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
