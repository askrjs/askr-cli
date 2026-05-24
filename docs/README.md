# @askrjs/cli

The unified CLI for the Askr platform.

## Contents

- [Overview](./overview.md) - Philosophy, install, and core commands
- [create](./create.md) - Scaffold a new project from a template
- [skills](./skills.md) - Install and sync Askr agent skills
- [skill-system-design](./skill-system-design.md) - Why the bundled skills are layered and how drift is constrained
- [skill-review-prompts](./skill-review-prompts.md) - Golden prompts for auditing the bundled skill system
- [add](./add.md) - Generate feature code into an existing project
- [Workflows](./workflows.md) - End-to-end CLI workflows

## Quick start

```bash
npm install -g @askrjs/cli
askr create startkit my-app
cd my-app
npm run dev
```

New projects created with `askr create` already receive the bundled Askr skills
in `skills/`. Pass `--no-skills` if you need a minimal scaffold instead.
