# CLI: add

Generate feature code into an existing Askr project.

> **Roadmap status:** `add` generators are not part of the shipped CLI yet.
> This page records the intended command shape so generated projects can align
> with platform conventions.

## Philosophy

Generators will scaffold files according to Askr conventions. Generated code
should remain ordinary Askr code: no runtime magic and no generator dependency.

## Planned Commands

```bash
askr add page <name>
askr add route <path>
askr add crud <model>
askr add table <name>
askr add form <name>
```

## `add page`

The planned `add page` command will scaffold a route component and register it
in the app router.

Expected output:

- `src/routes/<name>.tsx`
- Route registration in `src/router.tsx`

## `add crud`

The planned `add crud` command will scaffold list, detail, create, edit, and
delete UI for a model.

Expected output:

- `src/routes/<model>.tsx`
- `src/routes/<model>.detail.tsx`
- `src/features/<model>/<model>-table.tsx`
- `src/features/<model>/<model>-form.tsx`

## See Also

- [CLI overview](./overview.md)
- [Conventions](https://github.com/askrjs/askr/tree/main/docs/reference/conventions.md)
