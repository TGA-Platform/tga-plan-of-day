/**
 * /api/z-casuals
 * GET /api/z-casuals?centre=Edgeworth&date=2026-06-24
 *
 * Returns Z Staffing external casual shifts for a TGA centre on a given date.
 * Fetches live from Z Staffing API, upserts to Supabase for reporting, then returns.
 *
 * Auth (in priority order):
 *   1. Permanent API key: Z_API_KEY (KMS-encrypted, decrypted via Cognito Identity Pool credentials)
 *   2. Legacy: Z_REFRESH_TOKEN (Cognito refresh token → IdToken)
 */

import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from '@aws-sdk/client-cognito-identity';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';

const SUPABASE_URL = 'https://tgxpvzlibquqnldgmwho.supabase.co';
const SERVICE_KEY  = 'eyJhbG…6f1c';

const Z_COGNITO_REGION   = 'ap-southeast-2';
const Z_USER_POOL_ID     = 'ap-southeast-2_pFnKUT9rq';
const Z_IDENTITY_POOL_ID = 'ap-southeast-2:e95e4810-2cbf-4c3c-aab2-4a7f5de2ee4f';
const Z_CLIENT_ID        = '4brth3dn73p47s17m5p28lvi2r';
const Z_GRAPHQL_URL      = 'https://api.zrecruitment.com.au/graphql';

// TGA centre name → Z Staffing workspace UUID
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

// In-memory caches (survives warm function restarts, not cold starts)
let _tokenCache = null; // { idToken, expiresAt }
let _keyCache   = null; // { plaintext, expiresAt }

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
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  });

  const data = await resp.json();
  if (!data.AuthenticationResult) {
    throw new Error(`Z Staffing auth failed: ${JSON.stringify(data)}`);
  }

  const idToken   = data.AuthenticationResult.IdToken;
  const expiresIn = data.AuthenticationResult.ExpiresIn ?? 3600; // seconds
  _tokenCache = { idToken, expiresAt: now + expiresIn * 1000 };
  return idToken;
}

async function getAwsCredentials(idToken) {
  const providerName = `cognito-idp.${Z_COGNITO_REGION}.amazonaws.com/${Z_USER_POOL_ID}`;
  const logins = { [providerName]: idToken };

  const cognitoIdentity = new CognitoIdentityClient({ region: Z_COGNITO_REGION });

  const getIdResp = await cognitoIdentity.send(new GetIdCommand({
    IdentityPoolId: Z_IDENTITY_POOL_ID,
    Logins: logins,
  }));

  const credsResp = await cognitoIdentity.send(new GetCredentialsForIdentityCommand({
    IdentityId: getIdResp.IdentityId,
    Logins: logins,
  }));

  const creds = credsResp.Credentials;
  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretKey,
    sessionToken: creds.SessionToken,
    expiration: creds.Expiration,
  };
}

async function decryptKmsKey(encryptedBase64, credentials) {
  const kms = new KMSClient({ region: Z_COGNITO_REGION, credentials });
  const resp = await kms.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedBase64, 'base64'),
  }));
  return Buffer.from(resp.Plaintext).toString('utf-8');
}

async function getDecryptedApiKey() {
  const encryptedKey = process.env.Z_API_KEY;
  if (!encryptedKey) return null;

  const now = Date.now();
  if (_keyCache && _keyCache.expiresAt - now > 5 * 60 * 1000) {
    return _keyCache.plaintext;
  }

  const idToken = await getIdToken();
  const awsCreds = await getAwsCredentials(idToken);
  const plaintext = await decryptKmsKey(encryptedKey, awsCreds);

  // Cache until AWS credentials expire, or 1 hour if unknown
  const expiresAt = awsCreds.expiration
    ? new Date(awsCreds.expiration).getTime()
    : now + 60 * 60 * 1000;

  _keyCache = { plaintext, expiresAt };
  return plaintext;
}

async function getAuthToken() {
  // Try the permanent KMS-encrypted API key first (only when explicitly enabled).
  // The Cognito Identity Pool role currently lacks kms:Decrypt permission for this
  // key, so we keep it gated behind Z_API_KEY_ENABLED until Z Staffing fixes that.
  if (process.env.Z_API_KEY_ENABLED === 'true') {
    try {
      const apiKey = await getDecryptedApiKey();
      if (apiKey) {
        console.log('[z-casuals] Using KMS-decrypted permanent API key');
        return { token: apiKey, source: 'api-key' };
      }
    } catch (err) {
      console.error('[z-casuals] KMS decrypt failed, falling back to Cognito refresh token:', err.message);
    }
  }

  // Fallback to legacy Cognito refresh-token flow
  const idToken = await getIdToken();
  console.log('[z-casuals] Using Cognito IdToken from refresh token');
  return { token: idToken, source: 'cognito' };
}

async function queryZGraphQL(authToken, query, variables = {}) {
  const resp = await fetch(Z_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'COGNITO ' + authToken.token,
    },
    body: JSON.stringify({ operationName: null, query, variables }),
  });
  const data = await resp.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

/** Convert epoch ms to HH:MM AEST */
function epochToTime(ms) {
  return new Date(parseInt(ms)).toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Parse "Filled|1782259200000" → "Filled" */
function parseStatus(raw) {
  if (!raw) return 'Unknown';
  return raw.split('|')[0];
}

async function upsertToSupabase(rows) {
  if (!rows.length) return;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/z_casuals`, {
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
    // Table may not exist yet — try to create it then retry once
    if (resp.status === 404 || txt.includes('does not exist')) {
      await createTableIfNeeded();
      await fetch(`${SUPABASE_URL}/rest/v1/z_casuals`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
      });
    }
  }
}

async function createTableIfNeeded() {
  console.log('[z-casuals] Note: z_casuals table may need manual creation in Supabase.');
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
        educatorProfile {
          givenName
          surname
          certificationLevel
        }
      }
    }
  }
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { centre, date } = req.query;

  if (!centre || !date) {
    return res.status(400).json({ error: 'centre and date query params required' });
  }

  // Normalise centre name to match workspace map keys
  const normCentre = centre.trim();
  const workspaceId = TGA_WORKSPACE_MAP[normCentre];

  if (!workspaceId) {
    // Centre not in map — return empty rather than error (centre may not use Z Staffing)
    return res.status(200).json([]);
  }

  try {
    const auth = await getAuthToken();
    const gqlData = await queryZGraphQL(auth, JOB_QUERY, {
      workspaceId,
      withEducatorProfile: true,
    });

    const allJobs = gqlData?.getAllJobInformationForWorkspace?.jobs ?? [];

    // Filter to the requested date (AEST)
    const dayStart = new Date(`${date}T00:00:00+10:00`).getTime();
    const dayEnd   = new Date(`${date}T00:00:00+10:00`).getTime() + 86400000;

    const dayJobs = allJobs.filter(j => {
      const s = parseInt(j.startDate);
      return s >= dayStart && s < dayEnd;
    });

    // Shape results
    const results = dayJobs
      .filter(j => !j.isDraft) // exclude unpublished shifts
      .map(j => {
        const startMs  = parseInt(j.startDate);
        const endMs    = parseInt(j.endDate);
        const durationHrs = (endMs - startMs) / 3600000;
        const hourlyRate  = j.hourlyRateUsed ?? 0; // cents per hour (e.g. 5700 = $57/hr)
        const costCents   = Math.round(hourlyRate * durationHrs);

        const profile  = j.educatorProfile;
        const name     = profile
          ? `${profile.givenName} ${profile.surname}`.trim()
          : (j.educatorUserId ? null : null); // null = unfilled

        const certLevel = (
          j.educatorCertificationLevel ||
          profile?.certificationLevel  ||
          j.certificationLevel         ||
          'NONE'
        );

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
      .filter(j => j.isFilled && j.name); // only filled shifts with a known educator

    // Upsert to Supabase for reporting (fire-and-forget)
    const supabaseRows = results.map(r => ({
      centre:       normCentre,
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
    }));
    upsertToSupabase(supabaseRows).catch(err =>
      console.error('[z-casuals] Supabase upsert failed:', err.message)
    );

    return res.status(200).json(results);

  } catch (err) {
    console.error('[z-casuals] Error:', err.message);
    // Return empty rather than 500 so the plan of day still loads
    return res.status(200).json([]);
  }
}
