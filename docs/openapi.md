# OpenAPI artifact export

```bash
askr openapi --entry ./src/api.ts --output ./openapi.yml
askr openapi --entry ./src/api.ts --output ./openapi.yml --check
askr openapi --entry ./src/api.ts --output ./openapi.yml --json
```

The entry module must default-export an object with `toOpenApiDocument()`. Both
synchronous and asynchronous exporters are supported. The returned value must
be an OpenAPI 3.0.x or 3.1.x document with `info.title`, `info.version`, and
`paths`. Invalid documents fail before any output mutation.

Output is deterministic YAML written through a temporary sibling and atomic
rename. `--check` verifies byte equality without writing. The output path may
not equal the source entry. Loading the project module executes its top-level
code, so artifact generation should use a side-effect-free definition module.
`--json` provides machine-readable generated, checked, stale, and missing states.
