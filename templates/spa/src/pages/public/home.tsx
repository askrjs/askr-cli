import {
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  ShieldCheckIcon,
} from '@askrjs/lucide';
import { Link } from '@askrjs/askr/router';
import { Block, Button } from '@askrjs/themes/components';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@askrjs/themes/components';
import { Container, Section, Stack } from '@askrjs/themes/components';
import { EmptyState } from '@askrjs/themes/components';

const capabilities = [
  {
    icon: <BotIcon size={16} aria-hidden="true" />,
    title: 'Agent runs',
    description:
      'Track queued, running, approval, and completed work without collapsing it into one loading state.',
  },
  {
    icon: <ActivityIcon size={16} aria-hidden="true" />,
    title: 'Evented operations',
    description:
      'Make pending writes, projection lag, and stale read models visible before users need to ask.',
  },
  {
    icon: <ShieldCheckIcon size={16} aria-hidden="true" />,
    title: 'App-ready shell',
    description:
      'Use route branches, layouts, and theme primitives instead of a one-page demo wrapper.',
  },
];

export default function HomePage() {
  return (
    <>
      <Section paddingY="2xl">
        <Container size="xl">
          <Block class="hero-grid">
            <Stack gap="lg" class="hero-copy">
              <Badge>Route-first Askr SPA</Badge>
              <Stack gap="md">
                <h1>Operate agent workflows with a UI that tells the truth.</h1>
                <p class="lead">
                  {'{{appName}}'} is a focused Askr console for agentic
                  products: public branch, auth branch, app branch, theme
                  primitives, consistency-aware states, and no invented layout
                  system.
                </p>
              </Stack>
              <Block direction="row" gap="md" wrap>
                <Button asChild>
                  <Link href="/login">
                    Open console <ArrowRightIcon size={16} aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="secondary" asChild>
                  <Link href="/app">View demo dashboard</Link>
                </Button>
              </Block>
            </Stack>

            <Card variant="raised" class="hero-card">
              <CardHeader>
                <Block direction="row" gap="sm" align="center">
                  <span class="status-dot" />
                  <Badge>Projection current</Badge>
                </Block>
                <CardTitle>Command center</CardTitle>
                <CardDescription>
                  A concise preview of the authenticated shell users see after
                  sign-in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Stack gap="md">
                  <Block class="hero-row" padding="md">
                    <strong>12 active runs</strong>
                    <span>3 need review</span>
                  </Block>
                  <Block class="hero-row" padding="md">
                    <strong>98.7% success rate</strong>
                    <span>last 24 hours</span>
                  </Block>
                  <Block class="hero-row" padding="md">
                    <strong>event id 18,442</strong>
                    <span>read model synced</span>
                  </Block>
                </Stack>
              </CardContent>
            </Card>
          </Block>
        </Container>
      </Section>

      <Section paddingY="xl">
        <Container size="xl">
          <Block class="feature-grid">
            {capabilities.map((item) => (
              <Card>
                <CardHeader>
                  <span class="card-icon">{item.icon}</span>
                  <CardTitle>{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </Block>
        </Container>
      </Section>

      <Section paddingY="xl">
        <Container size="lg">
          <EmptyState
            icon={<CheckCircle2Icon size={26} aria-hidden="true" />}
            title="Built from solved primitives"
            description="The page uses Container, Section, Block, Stack, Card, Badge, Button, Header, Navbar, and EmptyState from @askrjs/themes."
            actions={
              <Button asChild>
                <Link href="/app/agents">Inspect agent runs</Link>
              </Button>
            }
          />
        </Container>
      </Section>
    </>
  );
}
