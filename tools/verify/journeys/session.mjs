// Sign-in and session (ADR 0014): the dev persona list, signing in, the
// session's grants, the CSRF rule on writes, and signing out. Dev sign-in only:
// Entra sign-in is covered by the server's auth scenario test, not here.
//
// Re-runnable: yes. It only creates and ends its own session.
export default {
  name: 'session',
  title: 'Session: dev sign-in, grants, CSRF header on writes, sign-out',
  rerunnable: true,
  personas: ['Rhea Castillo', 'Maya Chen'],
  run: async (t) => {
    await t.step('without a session the API answers 401', async () => {
      const response = await fetch(`${t.baseUrl}/api/session`);
      t.equal(response.status, 401, 'GET /api/session without a cookie');
    });

    await t.step('a write without the app header is refused (CSRF)', async () => {
      const response = await fetch(`${t.baseUrl}/api/auth/dev/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId: t.personaId('Maya Chen') }),
      });
      t.equal(response.status, 403, 'POST without x-requested-with');
    });

    await t.step('signed in, the session carries the person and their grants', async () => {
      const rhea = await t.as('Rhea Castillo');
      const session = t.ok(await rhea.get('/session'), 'Rhea reads her session');
      t.equal(session.person?.displayName, 'Rhea Castillo', 'the signed-in person');
      t.check(session.grants.includes('tenant_admin'), `grants: ${session.grants}`);
      const maya = await t.as('Maya Chen');
      t.equal(
        t.ok(await maya.get('/session'), 'Maya reads hers').grants,
        [],
        'an advisor has no grants',
      );
    });

    await t.step('after sign-out the cookie no longer works', async () => {
      const maya = await t.as('Maya Chen');
      t.equal((await maya.post('/auth/sign-out')).status, 204, 'sign-out');
      t.refused(await maya.get('/session'), 401, 'Unauthorized', 'the old cookie after sign-out');
    });
  },
};
