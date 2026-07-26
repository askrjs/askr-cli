# {{appName}}

This project is the progressive full-stack stage of an Askr application.

- Prefer functions, closures, and structural interfaces over classes.
- Keep action descriptors and schemas browser-safe under `src/actions` and `src/schemas.ts`.
- Keep handlers, repositories, secrets, and composition dependencies under `src/server`.
- Authorize every page action through the matched `route(..., { actions })` declaration.
- Keep `index.html` as the only document source. Preserve exactly one `<!--askr-head-->` and one `<!--askr-app-->` marker.
- Use native forms first; enhanced submission must preserve the same validation and authorization behavior.
- Never log cookies, authorization values, tokens, form fields, request bodies, or personal data.

## Recovery and completion

- Run `askr repair` after analyzer failures; it applies only safe mechanical fixes.
- Resolve remaining semantic diagnostics deliberately.
- Run `npm run check` before declaring work complete. It requires clean Askr analysis, then runs lint, typecheck, tests, and build.
