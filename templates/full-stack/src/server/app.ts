import { createAuth } from "@askrjs/auth";
import { createAskrApp } from "@askrjs/server/askr";
import { csrf, rateLimit, requestId, securityHeaders } from "@askrjs/server/middleware";
import { pageRegistry } from "../routes";
import { Message, MessageInput } from "../schemas";
import { telemetry } from "../telemetry";
import { createActionHandlers } from "./action-registry";
import type { AppDependencies } from "./dependencies";

export function createApp(deps: AppDependencies) {
  return createAskrApp({
    name: "{{appName}}",
    version: "1.0.0",
    dependencies: deps,
    pages: pageRegistry,
    api: {
      define(api) {
        api
          .post("/messages", {
            input: {
              body: {
                schema: MessageInput,
                mediaTypes: ["application/json"],
              },
            },
            documentation: { body: { required: true } },
            async handler(ctx, input, dependencies) {
              const message = { id: crypto.randomUUID(), value: input.body.value };
              await dependencies.actions.record({
                action: "api.create-message",
                value: message.value,
              });
              return ctx.created(message);
            },
          })
          .operationId("createMessage")
          .summary("Create a message")
          .tags("Messages")
          .use(
            csrf({ secret: process.env.CSRF_SECRET ?? "development-only-secret" }),
            rateLimit({ store: deps.rateLimits, limit: 30, windowMs: 60_000 }),
          )
          .created(Message)
          .badRequest()
          .unprocessableEntity()
          .tooManyRequests();
        api
          .post("/session", (ctx) => {
            const response = ctx.redirect("/", 303);
            return ctx.setCookie(response, "askr-session", "demo-session", {
              httpOnly: true,
              sameSite: "lax",
              secure: ctx.url.protocol === "https:",
              path: "/",
            });
          })
          .operationId("createSession")
          .summary("Create a demo session")
          .seeOther();
      },
    },
    auth: {
      resolver: createAuth({
        sessions: deps.sessions,
        principals: deps.principals,
        sessionCookie: "askr-session",
      }),
    },
    actions: {
      handlers: createActionHandlers(),
      csrf: { secret: process.env.CSRF_SECRET ?? "development-only-secret" },
    },
    middleware: [requestId(), securityHeaders()],
    telemetry,
  });
}
