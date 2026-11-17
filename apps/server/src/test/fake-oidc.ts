import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * A tiny in-process OpenID Connect issuer for sign-in tests. It answers the
 * discovery, JWKS and token endpoints that `openid-client` calls, signing ID
 * tokens with its own RSA key. The server hard-codes the Entra authority
 * (`https://login.microsoftonline.com/<tenant>/v2.0`), so the issuer is wired
 * in by replacing `globalThis.fetch` for that host only.
 *
 * `authorize(url, claims)` stands in for the person signing in at Microsoft:
 * it records the request's nonce and PKCE challenge and returns a code. Each
 * token response can be tampered with through `nextToken` to test refusals.
 */
const AUTHORITY = 'https://login.microsoftonline.com';

interface Grant {
  readonly claims: Readonly<Record<string, unknown>>;
  readonly nonce: string | null;
  readonly challenge: string | null;
  readonly redirectUri: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export const makeFakeEntra = (options: {
  readonly tenantId: string;
  readonly clientId: string;
}) => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomBytes(8).toString('hex');
  const issuer = `${AUTHORITY}/${options.tenantId}/v2.0`;
  const base = `${AUTHORITY}/${options.tenantId}`;
  const codes = new Map<string, Grant>();
  /** Overrides applied to the next ID token only (e.g. a different nonce or issuer). */
  let nextToken: Record<string, unknown> = {};

  const signJwt = (payload: Record<string, unknown>) => {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const body = b64url(JSON.stringify(payload));
    const signature = createSign('RSA-SHA256').update(`${header}.${body}`).sign(privateKey);
    return `${header}.${body}.${b64url(signature)}`;
  };

  const handle = async (url: URL, init: RequestInit | undefined): Promise<Response> => {
    if (url.href === `${issuer}/.well-known/openid-configuration`) {
      return json({
        issuer,
        authorization_endpoint: `${base}/oauth2/v2.0/authorize`,
        token_endpoint: `${base}/oauth2/v2.0/token`,
        jwks_uri: `${base}/discovery/v2.0/keys`,
        response_types_supported: ['code'],
        subject_types_supported: ['pairwise'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      });
    }
    if (url.href === `${base}/discovery/v2.0/keys`) {
      return json({
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }],
      });
    }
    if (url.href === `${base}/oauth2/v2.0/token`) {
      const form = new URLSearchParams(
        init?.body instanceof URLSearchParams ? init.body : String(init?.body ?? ''),
      );
      const code = form.get('code') ?? '';
      const grant = codes.get(code);
      codes.delete(code);
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!grant || grant.challenge !== challenge || grant.redirectUri !== form.get('redirect_uri'))
        return json({ error: 'invalid_grant' }, 400);
      const iat = Math.floor(Date.now() / 1000);
      const idToken = signJwt({
        iss: issuer,
        aud: options.clientId,
        iat,
        nbf: iat,
        exp: iat + 3600,
        sub: `sub-${String(grant.claims['oid'] ?? 'anonymous')}`,
        nonce: grant.nonce,
        tid: options.tenantId,
        ...grant.claims,
        ...nextToken,
      });
      nextToken = {};
      return json({
        access_token: randomBytes(16).toString('hex'),
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: idToken,
      });
    }
    return json({ error: 'not_found' }, 404);
  };

  const realFetch = globalThis.fetch;
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== AUTHORITY) return realFetch(input, init);
    return handle(url, init);
  };

  return {
    issuer,
    install: () => {
      globalThis.fetch = fetch;
    },
    uninstall: () => {
      globalThis.fetch = realFetch;
    },
    /** The person signs in at the issuer; returns the authorization code it would redirect with. */
    authorize: (authorizationUrl: string, claims: Readonly<Record<string, unknown>>) => {
      const params = new URL(authorizationUrl).searchParams;
      const code = randomBytes(16).toString('hex');
      codes.set(code, {
        claims,
        nonce: params.get('nonce'),
        challenge: params.get('code_challenge'),
        redirectUri: params.get('redirect_uri'),
      });
      return { code, state: params.get('state') ?? '' };
    },
    tamperNextToken: (overrides: Record<string, unknown>) => {
      nextToken = overrides;
    },
  };
};
