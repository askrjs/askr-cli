import { resource } from '@askrjs/askr/resources';
import { createPlot } from '@askrjs/charts';
import { AlertCircleIcon, RefreshCwIcon } from '@askrjs/lucide';
import { Button } from '@askrjs/themes/components';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@askrjs/themes/components';
import { Block, Inline, Section, Stack } from '@askrjs/themes/components';
import { EmptyState } from '@askrjs/themes/components';
import MetricCard from '../../components/shared/metric-card';
import StatusBadge from '../../components/shared/status-badge';
import type { OperationsChartRow } from '../../adapters/operations-client';
import { loadOperations } from '../../features/operations/operations.query';
import { formatRelativeTime } from '../../shared/format';

const OperationsPlot = createPlot<OperationsChartRow>();

export default function AdminHomePage() {
  const operations = resource(({ signal }) => loadOperations({ signal }), []);
  const snapshot = operations.value;

  if (operations.error && !snapshot) {
    return (
      <Section>
        <EmptyState
          icon={<AlertCircleIcon size={24} aria-hidden="true" />}
          title="Operations could not load"
          description="The dashboard keeps failures recoverable. Retry the owning resource instead of hiding the error in a toast."
          actions={<Button onPress={() => operations.refresh()}>Retry</Button>}
        />
      </Section>
    );
  }

  return (
    <Stack gap="5">
      <section class="page-heading">
        <Stack gap="2">
          <Badge>projection v{snapshot?.version ?? '...'}</Badge>
          <h1>Workspace home</h1>
          <p class="lead">
            A consistency-aware dashboard for agent runs, queue health, and
            event-sourced read models.
          </p>
        </Stack>
        <Inline gap="2" align="center">
          {operations.pending && snapshot ? <Badge>refreshing</Badge> : null}
          <Button variant="secondary" onPress={() => operations.refresh()}>
            <RefreshCwIcon size={14} aria-hidden="true" /> Refresh
          </Button>
        </Inline>
      </section>

      {operations.pending && !snapshot ? (
        <Block gap="md">
          <Skeleton style="height: 8rem" />
          <Skeleton style="height: 8rem" />
          <Skeleton style="height: 8rem" />
        </Block>
      ) : null}

      {snapshot ? (
        <>
          <Block class="metric-grid">
            {snapshot.metrics.map((metric) => (
              <MetricCard
                label={metric.label}
                value={metric.value}
                trend={metric.trend}
              />
            ))}
          </Block>

          <Block class="chart-grid">
            <Card>
              <CardHeader>
                <CardTitle>Run throughput</CardTitle>
                <CardDescription>
                  Accepted commands by work type.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OperationsPlot.Root
                  data={snapshot.throughput}
                  rowKey="label"
                  label="Run throughput"
                  description="Accepted commands by work type."
                >
                  <OperationsPlot.Bar x="label" y="value" />
                </OperationsPlot.Root>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Projection lag</CardTitle>
                <CardDescription>
                  Lower is better; stale states stay visible.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OperationsPlot.Root
                  data={snapshot.lag}
                  rowKey="label"
                  label="Projection lag"
                  description="Projection lag over the last hour."
                >
                  <OperationsPlot.Line x="label" y="value" />
                  <OperationsPlot.Point x="label" y="value" />
                </OperationsPlot.Root>
              </CardContent>
            </Card>
          </Block>

          {snapshot.consistency !== 'fresh' ? (
            <Alert variant="warning">
              Read models are {snapshot.consistency}. Last processed event is{' '}
              {snapshot.lastEventId}.
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Recent agent runs</CardTitle>
              <CardDescription>
                Run state is modeled as product state, not a single loading
                boolean.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div class="run-table-wrap">
                <table class="run-table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Status</th>
                      <th>Owner</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.runs.map((run) => (
                      <tr>
                        <td>
                          <strong>{run.title}</strong>
                          <span>{run.id}</span>
                        </td>
                        <td>
                          <StatusBadge status={run.status} />
                        </td>
                        <td>{run.owner}</td>
                        <td>{formatRelativeTime(run.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </Stack>
  );
}
