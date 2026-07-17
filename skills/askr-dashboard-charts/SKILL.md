---
name: askr-dashboard-charts
description: Build product dashboards and metric-heavy Askr routes with route-owned async state, shared formatting, and typed @askrjs/charts plots. Use for stat cards, mixed charts, live or follow-latest data, zoom, brush, selection, accessible summaries, and chart exports.
---

# Askr Dashboard Charts

Build dashboards that answer product questions without inventing parallel data, UI, or formatting systems.

## Inspect First

- Inspect the route or feature that owns the data.
- Inspect existing cards, tables, empty states, chart tokens, and format helpers.
- Inspect the nearest existing typed plot. In a generated SPA, start with `src/pages/app/admin-home.tsx`; in the CLI source, use `templates/spa/src/pages/app/admin-home.tsx`.

## Keep Ownership Clear

- Keep loading, empty, error, refresh, and composition state in the route or feature container.
- `src/components/shared` owns reusable stat cards, page headers, tables, and empty states.
- `src/features/<domain>` owns metric workflows and transforms.
- `src/shared` owns formatting helpers so cards, tables, and charts stay consistent.
- Keep row types app-owned; do not import package-owned datum types.

## Work In Order

1. Load dashboard data with `resource()` unless a wider owner already exists.
2. Model stable row keys and missing values before choosing marks.
3. Create each typed plot namespace once at module scope.
4. Compose the smallest plot that answers the product question.
5. Import `@askrjs/charts/styles` once at the app boundary.
6. Pair plots with summaries or on-demand data tables when precision matters.

## Compose A Typed Plot

```tsx
import { createPlot } from "@askrjs/charts";

type ThroughputRow = {
  id: string;
  timestamp: Date;
  completed: number;
  movingAverage: number;
};

const ThroughputPlot = createPlot<ThroughputRow>();

<ThroughputPlot.Root
  data={rows}
  rowKey="id"
  label="Completed runs over time"
  title="Run throughput"
  description="Completed runs with a moving average."
>
  <ThroughputPlot.Bar x="timestamp" y="completed" />
  <ThroughputPlot.Line x="timestamp" y="movingAverage" />
  <ThroughputPlot.Point x="timestamp" y="movingAverage" />
  <ThroughputPlot.Zoom axes="x" />
  <ThroughputPlot.Brush axis="x" modifier="shift" />
</ThroughputPlot.Root>;
```

## Handle Mixed, Live, And Interactive Data

- Use named scales and dual axes only when a mixed plot compares different units.
- Pass a reactive data getter for changing rows and update arrays with `appendPlotRows`, `upsertPlotRows`, `removePlotRows`, or `trimPlotRows`.
- Configure follow-latest by row count or time; let user pan or zoom pause following and provide an explicit `resumeLive()` action.
- Keep `view` and `selection` controlled when route or shared state owns them; otherwise use plot-local state.
- Add zoom, brush, legend filtering, or `onActivate` only when the workflow needs that interaction.
- Keep source and transformed exports distinguishable, and preserve access to visible or selected rows.

## Avoid

- Inline mock metrics inside page JSX.
- Hardcoded chart colors in runtime code.
- Decorative charts that do not answer a product question.
- Calling `createPlot()` inside a component or using unstable row keys.
- Treating missing or non-finite values as zero.
- Dense dashboards without loading, empty, and error states.

## Validate

- Verify cards, tables, tooltips, and exports share formatter logic; keep summaries and tooltip formatters valid for empty or missing rows.
- Verify mobile and desktop layouts in light and dark themes.
- Verify keyboard inspection, selection, zoom, brush, and the on-demand data table when used.
- Verify live updates retain stable selections and pause follow-latest after user navigation.
- Run the app's targeted tests and typecheck before its full acceptance command.

## Done When

- Route-owned async states remain explicit.
- Typed rows and stable keys drive the plot.
- The plot supports the product question without becoming a component gallery.
- Accessible summaries and precise data remain available without relying on canvas pixels.

## Handoff

- Use `askr-resources-data` when async ownership is the real blocker.
- Use `askr-theming` when the hard part is shell and visual coherence.
- Use `askr-testing-determinism` before closing responsive or stateful chart changes.
