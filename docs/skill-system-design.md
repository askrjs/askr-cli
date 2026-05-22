# Skill System Design

This note captures the current design of the bundled Askr skill system.

## Goals

- Small models should produce structurally correct Askr apps.
- Mid-range models should complete production-ready workflow work without broad architectural invention.
- Frontier models should stay constrained instead of overengineering the repo.
- All models should converge on the same route-first Askr structure.

## Layering

The bundle is intentionally layered so the default path stays narrow.

### Foundation sequence

- `askr-agent-execution`
- `askr-mental-model`
- `askr-project-structure`
- `askr-routing-layouts`
- `askr-runtime-reactivity`
- `askr-testing-determinism`

### Core workflows

These are the normal task skills for most application work: data loading, query and mutation ownership, async state truth, CRUD, auth, theming, UI composition, SSR and SSG, realtime, and agent workflows.

### Domain add-ons

These are opt-in skills for narrower surfaces such as API integration, observability, uploads, env config, dashboards, accessibility, and repeated design-system work.

### Low-frequency exception skills

- `askr-cli-vite` exists for scaffold choice and build wiring, not feature delivery.
- `askr-migration-react` exists for translation from foreign React-shaped inputs, not for ordinary Askr-first tasks.
- `askr-app-builder` exists for broad planning and dispatch, not as the default first skill.

## Recommendation policy

Builder recommendations are intentionally narrower than the full bundle. The default path should usually be the foundation sequence plus one specialized workflow skill. Broad planning and overlapping UI-system skills are only recommended when the prompt clearly spans multiple owned surfaces.

## Anti-drift policy

The bundle does not rely on prose alone. `askr skills review` provides deterministic smoke checks for recurring drift patterns.

Current negative checks reject:

- React hooks and TanStack Query as the default state model
- app-local primitive clones before `@askrjs/ui` or `@askrjs/themes`
- one-spinner async state modeling
- parallel architecture drift such as extra routers, store layers, service locators, and duplicate primitive systems

These prompts report both related skills and a repair focus so the next correction step is explicit.

## Skill authoring rule

Bundled skills are being normalized to one operational structure:

- Inspect First
- Use This When
- Do This In Order
- Copy This Shape
- Never Do These
- Validate
- Done When
- Handoff

This structure is optimized for constrained decision space and predictable execution across model sizes.

## Practical outcome

The intended behavior is simple:

- ordinary feature work starts on the foundation path and adds one owned workflow skill
- setup, migration, and broad planning skills stay off the default path
- review prompts catch the most common ways agents drift away from idiomatic Askr
