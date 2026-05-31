import { Link } from '@askrjs/askr/router';
import { Button } from '@askrjs/ui';
import { ActionRow, Card, CardGrid, SectionHeader } from '../components/site-shell';

const routeMap = [
  {
    path: '/',
    title: 'Home',
    note: 'Start here and link out to the rest of the sample.',
  },
  {
    path: '/workflow',
    title: 'Workflow',
    note: 'Show the edit, generate, and preview loop.',
  },
  {
    path: '/content',
    title: 'Content',
    note: 'Keep the route list visible and easy to extend.',
  },
  {
    path: '/preview',
    title: 'Preview',
    note: 'Keep one interactive page to confirm hydration.',
  },
] as const;

export default function Content() {
  return (
    <>
      <SectionHeader
        eyebrow="Content"
        title="Four routes, one clear source of truth."
        description="Keep the starter small and predictable. Add more routes when the app actually needs them."
        actions={
          <ActionRow>
            <Button asChild>
              <Link href="/workflow">Read the workflow</Link>
            </Button>
            <Button asChild>
              <Link href="/preview">Open the preview</Link>
            </Button>
          </ActionRow>
        }
      />

      <CardGrid>
        {routeMap.map((route) => (
          <Card eyebrow={route.path} title={route.title} description={route.note} />
        ))}
      </CardGrid>
    </>
  );
}
