import { derive, state } from '@askrjs/askr';
import { Toggle } from '@askrjs/askr-ui/primitives/toggle';
import { BarChart, DonutChart, Heatmap } from '@askrjs/askr-charts/components';
import { BarChart3Icon, FlameIcon, PieChartIcon } from '@askrjs/askr-lucide';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Grid,
  Inline,
  Section,
} from '@askrjs/askr-themes/components';

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
    <>
      <Section>
        <section class="page-header chart-page">
          <div class="page-header-copy">
            <p class="marketing-eyebrow">Charts</p>
            <h1>A few interactive charts, kept intentionally compact.</h1>
            <p class="marketing-lead text-muted">
              Switch the dataset and animation state to see the same page
              update without turning into a chart catalog.
            </p>
          </div>
        </section>
      </Section>

      <Section>
        <Card class="chart-toolbar" variant="raised">
          <CardHeader class="chart-meta">
            <CardTitle>{totals().headline}</CardTitle>
            <CardDescription>{totals().subhead}</CardDescription>
          </CardHeader>
          <CardContent class="chart-toolbar__body">
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
            <Grid minItemWidth="10rem" class="chart-stat-row" gap="3">
              <div class="chart-stat">
                <span class="text-muted">Composite score</span>
                <strong>{totals().total}</strong>
              </div>
              <div class="chart-stat">
                <span class="text-muted">Usage</span>
                <strong>{totals().active}</strong>
              </div>
            </Grid>
          </CardContent>
        </Card>
      </Section>

      <Section>
        <Grid minItemWidth="18rem" class="chart-grid" gap="4">
          <Card class="showcase-card chart-card" variant="raised">
            <CardHeader>
              <CardTitle>
                <Inline as="span" align="center" gap="2">
                  <BarChart3Icon size={16} />
                  <span>Throughput</span>
                </Inline>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart
                animate={animate()}
                label="App activity"
                summary="How the main app areas are moving right now."
                data={scenario() === 'launch' ? launchBar : scaleBar}
              />
            </CardContent>
          </Card>

          <Card class="showcase-card chart-card" variant="raised">
            <CardHeader>
              <CardTitle>
                <Inline as="span" align="center" gap="2">
                  <PieChartIcon size={16} />
                  <span>Mix</span>
                </Inline>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DonutChart
                animate={animate()}
                label="Traffic sources"
                summary="A small distribution view for the current scenario."
                totalLabel="traffic"
                data={scenario() === 'launch' ? launchDonut : scaleDonut}
              />
            </CardContent>
          </Card>

          <Card class="showcase-card chart-card" variant="raised">
            <CardHeader>
              <CardTitle>
                <Inline as="span" align="center" gap="2">
                  <FlameIcon size={16} />
                  <span>Heat view</span>
                </Inline>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Heatmap
                animate={animate()}
                label="Weekly intensity"
                summary="A compact flame-adjacent view using the available heatmap component."
                data={scenario() === 'launch' ? launchHeatmap : scaleHeatmap}
              />
            </CardContent>
          </Card>
        </Grid>
      </Section>
    </>
  );
}