# OpenAPI client generation

```bash
askr generate ./openapi.yml --output ./src/generated/api
askr generate ./openapi.yml --output ./src/generated/api --check
askr generate ./openapi.yml --output ./src/generated/api --json
```

Generation accepts OpenAPI 3.0.x and 3.1.x JSON or YAML, bundles local and HTTPS
references, and atomically replaces only directories carrying the CLI ownership
manifest. `--check` performs no writes and fails for missing, extra, or stale
generated files.
`--json` emits a single machine-readable success or error object.

Remote references use a DNS-pinned HTTPS connection for every root and redirect
hop. Cross-origin references require `--allow-ref-origin <https-origin>`.
`--ref-timeout-ms`, `--ref-max-bytes`, `--ref-max-depth`, and
`--ref-max-redirects` accept positive safe integers and bound remote reference
loading. Private, local, reserved, and mixed public/private DNS answers are
rejected.

Supported schemas include references, constants, enums, objects, arrays,
`oneOf`, `anyOf`, `allOf`, nullable 3.0 schemas, and 3.1 type arrays such as
`type: [string, 'null']`. Path-level parameters are inherited and operation-level
parameters override matching `(name, in)` pairs. Path template declarations are
validated before code is written.

Supported parameter locations are path, query, and header. Supported bodies and
responses are JSON, `+json`, text, URL-encoded forms, multipart forms, and binary
array buffers. Callbacks, webhooks, cookie parameters, response links, and
patterned `2XX` response keys are intentionally rejected with JSON-pointer
diagnostics because the current `@askrjs/fetch` descriptor contract has no
equivalent representation.
