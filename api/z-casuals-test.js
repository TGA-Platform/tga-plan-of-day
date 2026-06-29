/**
 * /api/z-casuals-test
 * Test endpoint for the new permanent Z Staffing API key.
 * Decrypts the KMS-encrypted Z_API_KEY using Cognito Identity Pool credentials,
 * then tries multiple auth header formats. Does NOT write to Supabase.
 */

import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from '@aws-sdk/client-cognito-identity';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';

const Z_COGNITO_REGION = 'ap-southeast-2';
const Z_USER_POOL_ID   = 'ap-southeast-2_pFnKUT9rq';
const Z_IDENTITY_POOL_ID = 'ap-southeast-2:e95e4810-2cbf-4c3c-aab2-4a7f5de2ee4f';
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
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  });

  const data = await resp.json();
  if (!data.AuthenticationResult) {
    throw new Error(`Cognito auth failed: ${JSON.stringify(data)}`);
  }

  const idToken = data.AuthenticationResult.IdToken;
  const expiresIn = data.AuthenticationResult.ExpiresIn ?? 3600;
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

async function tryAuthHeader(authHeader, workspaceId) {
  const resp = await fetch(Z_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: JSON.stringify({
      operationName: null,
      query: JOB_QUERY,
      variables: { workspaceId, withEducatorProfile: true },
    }),
  });

  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  return {
    status: resp.status,
    statusText: resp.statusText,
    authHeader: authHeader.replace(/^(.{30}).*(.{20})$/, '$1...$2'),
    bodyPreview: text.slice(0, 500),
    hasJobs: !!json?.data?.getAllJobInformationForWorkspace?.jobs,
    jobCount: json?.data?.getAllJobInformationForWorkspace?.jobs?.length ?? null,
    errors: json?.errors?.map(e => e.message) ?? null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { centre, date } = req.query;
  if (!centre) {
    return res.status(400).json({ error: 'centre query param required' });
  }

  const workspaceId = TGA_WORKSPACE_MAP[centre.trim()];
  if (!workspaceId) {
    return res.status(200).json({ error: 'Centre not in workspace map', centre });
  }

  const encryptedKey = process.env.Z_API_KEY;
  if (!encryptedKey) {
    return res.status(200).json({ error: 'Z_API_KEY env var not set' });
  }

  const debug = { steps: [] };

  try {
    debug.steps.push('Getting Cognito IdToken from refresh token...');
    const idToken = await getIdToken();
    debug.steps.push('Got IdToken.');

    debug.steps.push('Getting AWS credentials from Cognito Identity Pool...');
    const awsCreds = await getAwsCredentials(idToken);
    debug.steps.push(`Got AWS credentials. Expires: ${awsCreds.expiration}`);

    debug.steps.push('Decrypting Z_API_KEY via KMS...');
    const decryptedKey = await decryptKmsKey(encryptedKey, awsCreds);
    debug.steps.push(`Decrypted key length: ${decryptedKey.length}`);

    const attempts = [
      { name: 'COGNITO prefix', header: `COGNITO ${decryptedKey}` },
      { name: 'Bearer prefix', header: `Bearer ${decryptedKey}` },
      { name: 'Raw key', header: decryptedKey },
      { name: 'ApiKey prefix', header: `ApiKey ${decryptedKey}` },
      { name: 'x-api-key header', header: `placeholder` }, // handled separately below
    ];

    const results = [];
    for (const a of attempts) {
      if (a.name === 'x-api-key header') {
        try {
          const resp = await fetch(Z_GRAPHQL_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': decryptedKey,
            },
            body: JSON.stringify({
              operationName: null,
              query: JOB_QUERY,
              variables: { workspaceId, withEducatorProfile: true },
            }),
          });
          const text = await resp.text();
          let json = null;
          try { json = JSON.parse(text); } catch {}
          results.push({
            name: a.name,
            status: resp.status,
            statusText: resp.statusText,
            bodyPreview: text.slice(0, 500),
            hasJobs: !!json?.data?.getAllJobInformationForWorkspace?.jobs,
            jobCount: json?.data?.getAllJobInformationForWorkspace?.jobs?.length ?? null,
            errors: json?.errors?.map(e => e.message) ?? null,
          });
        } catch (err) {
          results.push({ name: a.name, error: err.message });
        }
        continue;
      }
      try {
        const result = await tryAuthHeader(a.header, workspaceId);
        results.push({ name: a.name, ...result });
      } catch (err) {
        results.push({ name: a.name, error: err.message });
      }
    }

    return res.status(200).json({
      centre: centre.trim(),
      workspaceId,
      encryptedKeyLength: encryptedKey.length,
      decryptedKeyLength: decryptedKey.length,
      debug,
      attempts: results,
    });

  } catch (err) {
    debug.steps.push(`Error: ${err.message}`);
    return res.status(200).json({
      centre: centre.trim(),
      workspaceId,
      error: err.message,
      debug,
    });
  }
}
