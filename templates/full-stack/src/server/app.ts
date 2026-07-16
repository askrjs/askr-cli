import { createAuth } from '@askrjs/auth';
import { createServerApp } from '@askrjs/server';
import { createAskrPageHandler } from '@askrjs/server/askr';
import { csrf, rateLimit, requestId, securityHeaders } from '@askrjs/server/middleware';
import { createApi } from '@askrjs/server/openapi';
import { pageRegistry } from '../routes';
import { Message, MessageInput } from '../schemas';
import { telemetry } from '../telemetry';
import { createActions } from './action-registry';
import type { AppDependencies } from './dependencies';

export function createApp(deps: AppDependencies) {
  const api = createApi<AppDependencies>({
    info: { title: '{{appName}} API', version: '1.0.0' },
  });
  api.post('/api/messages', {
    input: {
      body: {
        schema: MessageInput,
        mediaTypes: ['application/json'],
      },
    },
    documentation: { body: { required: true } },
    async handler(ctx, input, dependencies) {
      const message = { id: crypto.randomUUID(), value: input.body.value };
      await dependencies.actions.record({ action: 'api.create-message', value: message.value });
      return ctx.created(message);
    },
  })
    .operationId('createMessage')
    .summary('Create a message')
    .tags('Messages')
    .use(
      csrf({ secret: process.env.CSRF_SECRET ?? 'development-only-secret' }),
      rateLimit({ store: deps.rateLimits, limit: 30, windowMs: 60_000 }),
    )
    .created(Message)
    .badRequest()
    .unprocessableEntity()
    .tooManyRequests();

  const router = api.createRouter(deps);
  router.post('/api/session', (ctx) => {
    const response = ctx.redirect('/', 303);
    return ctx.setCookie(response, 'askr-session', 'demo-session', {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.url.protocol === 'https:',
      path: '/',
    });
  });
  return createServerApp({
    router,
    auth: createAuth({
      sessions: deps.sessions,
      principals: deps.principals,
      sessionCookie: 'askr-session',
    }),
    middleware: [requestId(), securityHeaders()],
    telemetry,
    fallback: createAskrPageHandler({
      registry: pageRegistry,
      actions: createActions(deps),
    }),
  });
}
