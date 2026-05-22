---
name: askr-env-config
description: Use when configuring Askr apps with environment variables, API base URLs, feature flags, deployment config, local mocks, generated client configuration, and separating config from runtime state.
---

# Askr Env Config

Use this for environment-specific application configuration.

## Inspect First

- Existing Vite environment usage and app config helpers.
- Generated API client configuration.
- Local mock data and development-only switches.
- Deployment target requirements.

## Placement

- Put config parsing and defaults in `src/shared/config` or an existing shared config module.
- Pass API base URLs and auth providers into `src/adapters`.
- Keep feature flags readable from features and pages without coupling them to transport details.
- Keep secrets out of client bundles.

## Rules

- Validate required public env values at app startup.
- Prefix and document public client-side variables according to the build system in use.
- Prefer typed config objects over ad hoc `import.meta.env` reads throughout the app.
- Make local mocks explicit and easy to disable.

## Event-Sourced Apps

- Configure projection polling, stream endpoints, and reconnect intervals centrally.
- Keep consistency timeouts and stale thresholds named and documented.
- Make event-stream fallback behavior explicit.

## Avoid

- Reading env variables directly in many components.
- Shipping server secrets to the browser.
- Hidden dev mocks that change production behavior.
- Feature flags that fork route structure unpredictably.

## Checks

- Missing required config fails early with a useful message.
- API adapters receive config through one boundary.
- Local, staging, and production config paths are obvious.
- Tests can override config deterministically.
