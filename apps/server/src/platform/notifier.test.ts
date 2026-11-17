import { assert, it } from '@effect/vitest';
import { Effect } from 'effect';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { Notifier, NotifierSmtp, type OutgoingMessage } from './notifier.ts';

/**
 * The SMTP transport against a minimal in-process relay (ADR 0018). Proves a
 * message reaches the relay as rendered, and that a refusal becomes a
 * NotifyFailed the dispatcher can retry, never a crash.
 */
interface Relay {
  readonly port: number;
  readonly received: Array<string>;
  readonly close: () => Promise<void>;
}

const fakeRelay = (refuseRecipient = false): Promise<Relay> =>
  new Promise((resolve) => {
    const received: Array<string> = [];
    const server: Server = createServer((socket) => {
      let data = false;
      let buffer = '';
      socket.write('220 relay.test ESMTP\r\n');
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          received.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          data = false;
          socket.write('250 queued\r\n');
        }
        let newline = buffer.indexOf('\r\n');
        while (!data && newline !== -1) {
          const line = buffer.slice(0, newline).toUpperCase();
          buffer = buffer.slice(newline + 2);
          if (line.startsWith('EHLO') || line.startsWith('HELO'))
            socket.write('250 relay.test\r\n');
          else if (line.startsWith('MAIL')) socket.write('250 ok\r\n');
          else if (line.startsWith('RCPT'))
            socket.write(refuseRecipient ? '550 no such user\r\n' : '250 ok\r\n');
          else if (line.startsWith('DATA')) {
            data = true;
            socket.write('354 go ahead\r\n');
          } else if (line.startsWith('QUIT')) {
            socket.end('221 bye\r\n');
          } else socket.write('250 ok\r\n');
          newline = buffer.indexOf('\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        received,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });

const message: OutgoingMessage = {
  channel: 'email',
  to: { personId: 'per_x', email: 'maya.chen@northwind.example' },
  subject: 'Leo Okonkwo signed an observation about your work',
  lines: ['Hi Maya,', 'Leo Okonkwo wrote down what they saw. Read it in the app.'],
  link: 'http://localhost:5400/observations/obs_0123456789abcdef',
};

const sendVia = (port: number) =>
  Effect.gen(function* () {
    const notifier = yield* Notifier;
    return yield* notifier.send(message);
  }).pipe(
    Effect.provide(
      NotifierSmtp({ host: '127.0.0.1', port, secure: false, from: 'app@northwind.example' }),
    ),
  );

it.effect('delivers the rendered message to the relay', () =>
  Effect.gen(function* () {
    const relay = yield* Effect.promise(() => fakeRelay());
    yield* sendVia(relay.port);
    yield* Effect.promise(relay.close);
    const [mail] = relay.received;
    assert.isDefined(mail);
    assert.include(mail, 'To: maya.chen@northwind.example');
    assert.include(mail, 'Subject: Leo Okonkwo signed an observation about your work');
    assert.include(mail, 'http://localhost:5400/observations/obs_0123456789abcdef');
  }),
);

it.effect('a refused recipient is a NotifyFailed, not a crash', () =>
  Effect.gen(function* () {
    const relay = yield* Effect.promise(() => fakeRelay(true));
    const error = yield* sendVia(relay.port).pipe(Effect.flip);
    yield* Effect.promise(relay.close);
    assert.strictEqual(error._tag, 'NotifyFailed');
  }),
);
