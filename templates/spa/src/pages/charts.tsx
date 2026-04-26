import { derive, state } from '@askrjs/askr';
import { Button } from '@askrjs/askr-ui/primitives/button';
import { Toggle } from '@askrjs/askr-ui/primitives/toggle';
import { BarChart, DonutChart, Heatmap } from '@askrjs/askr-charts/components';
import { BarChart3Icon, FlameIcon, PieChartIcon } from '@askrjs/askr-lucide';

const launchBar = [
  { label: 'Docs', value: 42 },
  { label: 'Trials', value: 58 },
  { label: 'Teams', value: 33 },
  { label: 'Deploys', value: 27 },
];

const scaleBar = [
  { label: 'Docs', value: 64 },
  { label: 'Trials', value: 49 },
  { label: 'Teams', value: 51 },
  { label: 'Deploys', value: 44 },
];

const launchDonut = [
  { label: 'Direct', value: 46 },
  { label: 'Templates', value: 29 },
  { label: 'Partners', value: 25 },
];

const scaleDonut = [
  { label: 'Direct', value: 33 },
  { label: 'Templates', value: 37 },
  { label: 'Partners', value: 30 },
];

const launchHeatmap = [
  { x: 'Mon', y: 'Week 1', value: 8 },
  { x: 'Tue', y: 'Week 1', value: 10 },
  { x: 'Wed', y: 'Week 1', value: 7 },
  { x: 'Thu', y: 'Week 1', value: 11 },
  { x: 'Mon', y: 'Week 2', value: 9 },
  { x: 'Tue', y: 'Week 2', value: 12 },
  { x: 'Wed', y: 'Week 2', value: 8 },
  { x: 'Thu', y: 'Week 2', value: 13 },
];

const scaleHeatmap = [
  { x: 'Mon', y: 'Week 1', value: 14 },
  { x: 'Tue', y: 'Week 1', value: 12 },
  { x: 'Wed', y: 'Week 1', value: 16 },
  { x: 'Thu', y: 'Week 1', value: 18 },
  { x: 'Mon', y: 'Week 2', value: 15 },
  { x: 'Tue', y: 'Week 2', value: 17 },
  { x: 'Wed', y: 'Week 2', value: 19 },
  { x: 'Thu', y: 'Week 2', value: 20 },
];

export default function Charts() {
  const scenario = state('launch' as 'launch' | 'scale');
  const animate = state(true);

  const totals = derive(() => {
    if (scenario() === 'launch') {
      return {
        headline: 'Launch mode',
        subhead: 'Smaller footprint, faster spikes, more uneven engagement.',
        total: 160,
        active: '2.4k weekly users',
      };
    }

    return {
      headline: 'Scale mode',
      subhead: 'Higher throughput and steadier activity across the board.',
      total: 208,
      active: '4.1k weekly users',
    };
  });

  return (
    <div class="chart-page">
      <section class="page-header">
        <div class="page-header-copy">
          <p class="marketing-eyebrow">Charts</p>
          <h1>A few interactive charts, kept intentionally compact.</h1>
          <p class="marketing-lead text-muted">
            Switch the dataset and animation state to see the same page update
            without turning into a chart catalog.
          </p>
        </div>
      </section>

      <section class="panel chart-toolbar">
        <div class="chart-meta">
          <h3>{totals().headline}</h3>
          <p class="text-muted">{totals().subhead}</p>
        </div>
        <div class="chart-toggle-row">
          <Button
            variant={scenario() === 'launch' ? 'primary' : 'secondary'}
            onPress={() => scenario.set('launch')}
          >
            Launch
          </Button>
          <Button
            variant={scenario() === 'scale' ? 'primary' : 'secondary'}
            onPress={() => scenario.set('scale')}
          >
            Scale
          </Button>
          <Toggle
            pressed={animate()}
            onPress={() => animate.set((value) => !value)}
          >
            Animate
          </Toggle>
        </div>
        <div class="chart-stat-row">
          <div class="chart-stat">
            <span class="text-muted">Composite score</span>
            <strong>{totals().total}</strong>
          </div>
          <div class="chart-stat">
            <span class="text-muted">Usage</span>
            <strong>{totals().active}</strong>
          </div>
        </div>
      </section>

      <section class="chart-grid">
        <div class="panel showcase-section">
          <h3>
            <BarChart3Icon size={16} /> Throughput
          </h3>
          <BarChart
            animate={animate()}
            label="App activity"
            summary="How the main app areas are moving right now."
            data={scenario() === 'launch' ? launchBar : scaleBar}
          />
        </div>

        <div class="panel showcase-section">
          <h3>
            <PieChartIcon size={16} /> Mix
          </h3>
          <DonutChart
            animate={animate()}
            label="Traffic sources"
            summary="A small distribution view for the current scenario."
            totalLabel="traffic"
            data={scenario() === 'launch' ? launchDonut : scaleDonut}
          />
        </div>

        <div class="panel showcase-section">
          <h3>
            <FlameIcon size={16} /> Heat view
          </h3>
          <Heatmap
            animate={animate()}
            label="Weekly intensity"
            summary="A compact flame-adjacent view using the available heatmap component."
            data={scenario() === 'launch' ? launchHeatmap : scaleHeatmap}
          />
        </div>
      </section>
    </div>
  );
}