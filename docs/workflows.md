# CLI Workflows

End-to-end CLI workflows for common Askr tasks.

These workflows assume `@askrjs/cli` is installed globally, so the command surface is `askr {command} [args]`.

## Start a new application

```bash
# Create a full-featured application starter
askr create startkit my-app
cd my-app
askr skills install
npm run dev
```

## Start a minimal SPA

```bash
askr create spa my-spa
cd my-spa
askr skills install
npm run dev
```

## Update agent skills

```bash
askr skills sync
```

This refreshes bundled `askr-*` skills in `.skills/` and leaves unrelated custom
skills alone.

## Generate a static site

```bash
# Create an SSG project
askr create ssg my-site
cd my-site

# Build static output
npm run build

# Or run SSG directly with a config
askr ssg --config ./ssg.config.ts --output ./dist/static
```

## Build and preview

```bash
npm run build
npm run preview
```

## See also

- [create](./create.md)
- [skills](./skills.md)
- [add](./add.md)
- [SSG guide](https://github.com/askrjs/askr/tree/main/docs/guides/ssg.md)
