# `askr database`

The unified CLI intentionally contains no ORM implementation. It resolves
`@askrjs/orm/tooling` from the selected project only when `database` is invoked,
then forwards the original arguments and IO. This prevents a global or
transitive CLI version from changing project migration semantics.

```text
askr database validate [--database <name>]
askr database generate [--database <name>]
askr database migration create [--database <name>]
askr database migration status --database <name>
askr database migration plan --database <name>
askr database migration apply --database <name> [--yes]
askr database migration resolve <id> --database <name> --applied
```

Flat single-database projects may omit `--database`. Named registries require
`--database`; use `--all` only when every configured database is deliberately
selected. All commands support `--cwd` and `--json`.

`validate` is read-only with respect to source and the target database.
`generate` writes migrations and generated artifacts but never applies them.
`migration apply` displays the pending ids and risk markers before prompting.
Programmatic application belongs to `@askrjs/orm` and never prompts.
