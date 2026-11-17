// The API journey harness: plain `fetch` against a running server, the dev
// sign-in endpoint and the seeded personas. A journey is a module whose default
// export is `{ name, title, rerunnable, personas, run(t) }`; `run` drives the
// API through `t` and records each step. Run one with
// `pnpm verify run <feature-id> --kind api`.

/** A failed expectation: the journey found the product doing something else. */
export class Expectation extends Error {}

/** A step that could not be exercised on this data; never counted as passed. */
class Skip extends Error {}

const HEADERS = { 'x-requested-with': 'fetch', accept: 'application/json' };

/** Reads a response body as JSON when it is JSON, else as text (or null when empty). */
const bodyOf = async (response) => {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const short = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return '';
  return text.length > 400 ? `${text.slice(0, 400)}...` : text;
};

/** A signed-in persona: a cookie and a small JSON client that records every call. */
const client = (baseUrl, persona, cookie, record) => {
  const call = async (method, path, payload) => {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        ...HEADERS,
        cookie,
        ...(payload !== undefined && { 'content-type': 'application/json' }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await bodyOf(response);
    record({ persona: persona.person.displayName, method, path, status: response.status, body });
    return { status: response.status, body };
  };
  return {
    id: persona.person.id,
    name: persona.person.displayName,
    get: (path) => call('GET', path),
    post: (path, payload = {}) => call('POST', path, payload),
    put: (path, payload) => call('PUT', path, payload),
    patch: (path, payload) => call('PATCH', path, payload),
  };
};

/** Signs in a seeded persona by display name; returns its client. */
const signIn = async (baseUrl, personas, name, record) => {
  const persona = personas.find((p) => p.person.displayName === name);
  if (!persona) throw new Expectation(`persona "${name}" is not seeded`);
  const response = await fetch(`${baseUrl}/api/auth/dev/sign-in`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ personId: persona.person.id }),
  });
  if (response.status !== 204)
    throw new Expectation(`dev sign-in as ${name} answered ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return client(baseUrl, persona, cookie, record);
};

/**
 * Runs one journey and returns its result. Steps run in order; the first
 * failed expectation stops the journey (later steps are reported as not run).
 */
export const runJourney = async (journey, baseUrl) => {
  const started = Date.now();
  const steps = [];
  let current = null;
  const record = (call) => current?.calls.push(call);
  const personas = await (await fetch(`${baseUrl}/api/auth/dev/personas`)).json();
  const sessions = new Map();
  const t = {
    baseUrl,
    /** A run-unique suffix, for names that must not collide with an earlier run. */
    stamp: new Date()
      .toISOString()
      .replaceAll(/[^0-9]/g, '')
      .slice(2, 14),
    personaId: (name) => personas.find((p) => p.person.displayName === name)?.person.id,
    as: async (name) => {
      if (!sessions.has(name)) sessions.set(name, await signIn(baseUrl, personas, name, record));
      return sessions.get(name);
    },
    step: async (title, fn) => {
      current = { title, status: 'passed', calls: [] };
      steps.push(current);
      try {
        return await fn();
      } catch (error) {
        if (error instanceof Skip) {
          current.status = 'skipped';
          current.error = error.message;
          return undefined;
        }
        current.status = error instanceof Expectation ? 'failed' : 'error';
        current.error = error.message;
        throw error;
      }
    },
    /** The body of a 2xx response, or a failed expectation naming the call. */
    ok: (response, what) => {
      if (response.status >= 200 && response.status < 300) return response.body;
      throw new Expectation(
        `${what}: expected success, got ${response.status} ${short(response.body)}`,
      );
    },
    /** A refusal with this status and error tag (HttpApi encodes `_tag`). */
    refused: (response, status, tag, what) => {
      const gotTag = response.body && typeof response.body === 'object' ? response.body._tag : null;
      if (response.status === status && (tag === undefined || gotTag === tag)) return response.body;
      throw new Expectation(
        `${what}: expected ${status}${tag ? ` ${tag}` : ''}, got ${response.status} ${short(response.body)}`,
      );
    },
    equal: (actual, expected, what) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Expectation(`${what}: expected ${short(expected)}, got ${short(actual)}`);
    },
    check: (condition, what) => {
      if (!condition) throw new Expectation(what);
    },
    /** Ends the current step as skipped (the data does not reach the path); the journey goes on. */
    skip: (reason) => {
      throw new Skip(reason);
    },
  };
  let status = 'passed';
  let error = null;
  try {
    await journey.run(t);
  } catch (e) {
    status = e instanceof Expectation ? 'failed' : 'error';
    error = e.message;
  }
  // A journey with a skipped step is not reported as passed.
  const skipped = steps.filter((s) => s.status === 'skipped');
  if (status === 'passed' && skipped.length > 0) {
    status = 'skipped';
    error = skipped.map((s) => `${s.title}: ${s.error}`).join('; ');
  }
  return {
    name: journey.name,
    title: journey.title,
    rerunnable: journey.rerunnable,
    status,
    error,
    durationMs: Date.now() - started,
    steps: steps.map((s) => ({
      title: s.title,
      status: s.status,
      ...(s.error && { error: s.error }),
      calls: s.calls.map((c) => ({
        persona: c.persona,
        request: `${c.method} /api${c.path}`,
        status: c.status,
        // Bodies only for calls that did not succeed, where they explain the refusal.
        ...(c.status >= 300 && { body: short(c.body) }),
      })),
    })),
  };
};
