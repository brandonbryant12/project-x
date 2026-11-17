import { Context, Data, Effect, Layer, Redacted, Ref } from 'effect';
import { createTransport } from 'nodemailer';

/**
 * Delivery transport for the outbox (ADR 0018). The message is already
 * rendered from the closed templates, so a transport never sees more than
 * names, dates, counts and a link.
 *
 * Built: `log` (development), `smtp` (email through the firm's relay) and
 * `memory` (tests). Email is the only channel.
 */
export interface OutgoingMessage {
  readonly channel: 'email' | 'log';
  readonly to: { readonly personId: string; readonly email: string };
  readonly subject: string;
  readonly lines: ReadonlyArray<string>;
  readonly link: string;
}

export class NotifyFailed extends Data.TaggedError('NotifyFailed')<{ readonly reason: string }> {}

export class Notifier extends Context.Service<
  Notifier,
  {
    readonly transport: 'log' | 'smtp' | 'memory';
    readonly send: (message: OutgoingMessage) => Effect.Effect<void, NotifyFailed>;
  }
>()('@repo/server/Notifier') {}

export const NotifierLog = Layer.succeed(Notifier, {
  transport: 'log',
  send: (message) =>
    Effect.logInfo('notification', {
      channel: message.channel,
      to: message.to.personId,
      subject: message.subject,
      link: message.link,
    }),
});

/** Captures messages for tests; `sent` reads them back. */
export class SentMessages extends Context.Service<
  SentMessages,
  Ref.Ref<ReadonlyArray<OutgoingMessage>>
>()('@repo/server/SentMessages') {}

export const NotifierMemory = Layer.effectContext(
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyArray<OutgoingMessage>>([]);
    return Context.make(SentMessages, ref).pipe(
      Context.add(Notifier, {
        transport: 'memory' as const,
        send: (message: OutgoingMessage) => Ref.update(ref, (all) => [...all, message]),
      }),
    );
  }),
);

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Plain text first (it is what most mail clients preview), with a minimal HTML twin. */
export const emailBody = (message: OutgoingMessage) => ({
  text: [...message.lines, '', message.link].join('\n'),
  html: [
    ...message.lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${escapeHtml(message.link)}">Open it in the app</a></p>`,
  ].join('\n'),
});

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string | undefined;
  readonly password?: Redacted.Redacted<string> | undefined;
  readonly from: string;
}

/**
 * Email through the firm's SMTP relay. The message holds only what the closed
 * templates rendered (I20). Nothing about the message is logged beyond its kind
 * of failure.
 */
export const NotifierSmtp = (options: SmtpOptions) =>
  Layer.sync(Notifier, () => {
    const transport = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user && options.password
        ? { auth: { user: options.user, pass: Redacted.value(options.password) } }
        : {}),
    });
    return {
      transport: 'smtp' as const,
      send: (message: OutgoingMessage) =>
        Effect.tryPromise({
          try: () =>
            transport.sendMail({
              from: options.from,
              to: message.to.email,
              subject: message.subject,
              ...emailBody(message),
            }),
          catch: (cause) =>
            new NotifyFailed({
              reason: cause instanceof Error ? cause.name : 'smtp_error',
            }),
        }).pipe(Effect.asVoid),
    };
  });
