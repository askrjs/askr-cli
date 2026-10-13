# Server-owned provider authentication

Add a provider to an Askr starter, or select it while creating the app:

```sh
askr add auth google --origin https://app.example
askr create ssr my-app --auth google --origin https://app.example
```

The supported names are `auth0`, `microsoft`, `google`, and `apple`. Repeat
`--origin` to print the console settings for each environment. Origins must be
explicit HTTPS origins without credentials, a path, a query, or a fragment.
The command prints callback and local logout URLs, post-logout destinations,
application type, identity scopes, and provider-specific setup notes. Register
each environment separately in the provider console.

Both commands use the same generator. It adds a provider factory under
`src/auth/providers`, the server session configuration in `src/auth/server.ts`,
and the Core router binding in `src/auth/client.ts`. A second provider is added
beside the first. Repeating an unchanged command preserves the files byte for
byte. Generated provider configuration is explicitly owned: if it has been
customized, the command asks you to review that configuration rather than
overwriting it. Application code outside the generated configuration remains
application-owned.

The generator supports the SSR, full-stack, SPA, and StartKit starters. SPA and
StartKit gain the existing Askr server development/build pipeline. SSG cannot
own request-time sessions; use a server-backed starter instead. Unrecognized or
ambiguous application wiring is rejected with a corrective message.

## Server environment

The generator writes blank variable names to `.env.example`. It never reads
your actual `.env` or puts credential values into source, browser configuration,
or console output. Supply the values through the server process environment:

| Shared configuration  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `APP_ORIGIN`          | Exact HTTPS app origin for the running environment.  |
| `AUTH_SESSION_SECRET` | Strong independent server session-encryption secret. |

| Provider  | Required configuration names                                                   |
| --------- | ------------------------------------------------------------------------------ |
| Auth0     | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`                       |
| Microsoft | `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`        |
| Google    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                     |
| Apple     | `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_PATH` |

Apple's `.p8` private key is loaded and converted to a private JWK only in the
server provider module. The file contents are never generated or copied. Apple
requires a registered HTTPS domain and does not accept `localhost`; its callback
uses `form_post`. Google requires consent-screen configuration. Microsoft
requires an explicit tenant ID. Auth0 uses a tenant/custom-domain host and a
confidential web application.

Provider API resources and scopes are explicit application configuration in the
provider module. Initial generated configuration requests identity only. API
grant scopes never become authorization grants in the minimal browser session
snapshot. Configure each resource and its allowed scopes before requesting its
server token. Auth0 organization ID/name and connection restrictions, and
Google hosted-domain restrictions, are optional explicit policies; the default
generator does not guess them.

## Ownership and application policy

Provider-enabled starters use one server cookie/session authority and the Core
session binding. Selecting a provider replaces the StartKit demo login and
local-storage session wiring, or the full-stack demo cookie flow. Login links
use the configured provider route; logout retires private client data before
the next identity is published. Protected route groups declare their access
policy explicitly.

Existing default starters retain their explicit manual or demonstration mode
when no provider is selected. StartKit mock identity is demonstration data and
must never be used as server authorization. Manual authentication remains an
application-owned alternative; provider and manual resolver modes cannot be
combined automatically.

The provider session snapshot contains only authenticated identity, tenant, and
validated identity scopes. It does not supply application roles or permissions.
Keep resource authorization on the server. The default in-process session
authority supports a single server process; a multi-instance deployment needs
the documented shared store with CAS and whole-operation locking. Local logout
is the default. Provider continuation and token revocation are separate,
explicit operations, subject to the provider's capabilities.

After filling server configuration, run the generated Vite+ type, lint, test,
and build commands. Release qualification uses simulated signed providers;
live provider-account compatibility remains a separate check.

The production launcher passes `APP_ORIGIN` to the Node transport as its canonical
base URL and allowed host, including an explicit port. Set it to the same HTTPS
origin used by the provider session configuration. Generated provider projects
include Node types for their server code.
