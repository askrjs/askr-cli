import { Link } from '@askrjs/askr/router';
import { Button } from '@askrjs/ui';
import { ActionRow, Card, CardGrid, SectionHeader } from '../components/site-shell';

const highlights = [
  {
    title: 'Fast feedback',
    body: 'Run npm run dev and edit a page to stay in a SPA-style authoring loop.',
  },
  {
    title: 'Deterministic output',
    body: 'Keep the route map explicit in ssg.config.ts so the generated site is easy to reason about.',
  },
  {
    title: 'Hydrated preview',
    body: 'Keep one interactive route so you can verify static output and browser behavior together.',
  },
];

export default function Home() {
  return (
    <>
      <SectionHeader
        eyebrow="Static site generation"
        title="Build a multi-page site, then ship it as plain HTML."
        description="This sample keeps the loop small: author routes, preview in the SPA dev server, generate static files, and inspect the output."
        actions={
          <ActionRow>
            <Button asChild>
              <Link href="/workflow">See the workflow</Link>
            </Button>
            <Button asChild>
              <Link href="/preview">Open the preview</Link>
            </Button>
          </ActionRow>
        }
      />

      <CardGrid>
        {highlights.map((highlight) => (
          <Card title={highlight.title} description={highlight.body} />
        ))}
      </CardGrid>
    </>
  );
}
