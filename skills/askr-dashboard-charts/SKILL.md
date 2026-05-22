---
name: askr-dashboard-charts
description: Use when building askr dashboards, stat cards, activity feeds, product metrics, tables, async feedback, and @askrjs/charts visualizations such as area, bar, line, donut, heatmap, timeline, gauges, and chart chrome.
---

# Askr Dashboard Charts

Use this for product dashboards and metric-heavy screens.

## Inspect First

- `askr/docs/guides/dashboard.md`
- `askr-charts/README.md`
- `askr-cli/templates/startkit/src/pages/workspace/dashboard.tsx`
- Existing stat card, table, empty state, and chart styles.

## Dashboard Structure

- Route/page owns loading data and high-level composition.
- `src/components/shared` owns reusable stat cards, page headers, data tables, and empty states.
- `src/features/<domain>` owns domain-specific dashboard panels.
- `src/features/<domain>` owns metric loading workflows; `src/shared` owns formatting helpers.

## Data Pattern

```tsx
import { resource } from '@askrjs/askr/resources';

const dashboard = resource(({ signal }) => loadDashboard({ signal }), []);

if (dashboard.pending && !dashboard.value) return <p>Loading dashboard...</p>;
if (dashboard.error) return <p role="alert">Unable to load dashboard.</p>;
```

Keep metric formatting in helpers so cards, tables, and charts stay deterministic.

## Chart Pattern

```tsx
import { AreaChart, ChartPanel, ChartShell } from '@askrjs/charts/components';

<ChartShell title="Revenue" description="Last 7 days">
  <ChartPanel title="Trend">
    <AreaChart label="Revenue trend" data={revenue} />
  </ChartPanel>
</ChartShell>;
```

Import chart and theme CSS from app CSS:

```css
@import "@askrjs/charts/default";
@import "@askrjs/themes/default";
```

## Decision Rules

- Use charts for quick product reading, not full analytical exploration.
- Pair charts with labels, summaries, legends, or tables when the data needs precision.
- Use `ChartEmptyState` or app empty states when data is absent.
- Keep tooltips as an enhancement, not the only way to understand a value.

## Avoid

- Inline mock metrics inside page JSX.
- Hardcoded chart colors in runtime code.
- Decorative charts that do not answer a product question.
- Dense dashboards without loading, empty, and error states.

## Checks

- Cards and charts share formatter logic.
- The page scans cleanly at mobile, tablet, and desktop widths.
- Chart data has stable labels and keys.
- Loading, empty, error, and refresh states are visible.

## Source Files

- `askr/docs/guides/dashboard.md`
- `askr-charts/README.md`
- `askr-cli/templates/startkit/src/pages/workspace/dashboard.tsx`
