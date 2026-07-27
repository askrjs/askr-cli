import {
  BotIcon,
  CheckCircle2Icon,
  Clock3Icon,
  ShieldAlertIcon,
} from '@askrjs/lucide';
import { For } from '@askrjs/askr/control';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@askrjs/themes/components';
import { Block, Inline, Stack } from '@askrjs/themes/components';
import StatusBadge, {
  type RunStatus,
} from '../../components/shared/status-badge';

const runs: Array<{
  id: string;
  title: string;
  status: RunStatus;
  event: string;
  description: string;
}> = [
  {
    id: 'reconcile-billing-projection',
    title: 'Reconcile billing projection',
    status: 'running',
    event: 'tool call: compare-ledger',
    description:
      'Streaming events are appended to the timeline and reconciled by event id.',
  },
  {
    id: 'approve-enterprise-workspace',
    title: 'Approve enterprise workspace',
    status: 'requires-action',
    event: 'approval requested',
    description:
      'Human gates are explicit product states, not hidden inside generated text.',
  },
  {
    id: 'refresh-onboarding-cohort',
    title: 'Refresh onboarding cohort',
    status: 'succeeded',
    event: 'projection caught up',
    description:
      'The read model confirms the command reached the user-visible view.',
  },
];

export default function AgentRunsPage() {
  return (
    <Stack gap="5">
      <section class="page-heading">
        <Stack gap="2">
          <Badge>agent workflows</Badge>
          <h1>Agent runs</h1>
          <p class="lead">
            Timelines make queued, running, approval, failure, and projection
            catch-up states easy to inspect.
          </p>
        </Stack>
      </section>

      <Block gap="md" class="agent-grid">
        <For each={runs} by={(run) => run.id}>
          {(run) => (
            <Card>
              <CardHeader>
                <Inline justify="between" align="start" gap="3">
                  <span class="card-icon">
                    {run.status === 'succeeded' ? (
                      <CheckCircle2Icon size={18} aria-hidden="true" />
                    ) : run.status === 'requires-action' ? (
                      <ShieldAlertIcon size={18} aria-hidden="true" />
                    ) : (
                      <BotIcon size={18} aria-hidden="true" />
                    )}
                  </span>
                  <StatusBadge status={run.status} />
                </Inline>
                <CardTitle>{run.title}</CardTitle>
                <CardDescription>{run.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Inline gap="2" align="center">
                  <Clock3Icon size={14} aria-hidden="true" />
                  <span>{run.event}</span>
                </Inline>
              </CardContent>
            </Card>
          )}
        </For>
      </Block>
    </Stack>
  );
}
