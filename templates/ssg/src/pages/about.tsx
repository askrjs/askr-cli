import { Link } from '@askrjs/askr/router';
import { Button } from '@askrjs/ui';
import { ActionRow, Card, CardGrid, SectionHeader } from '../components/site-shell';

const steps = [
  {
    number: '01',
    title: 'Start the dev server',
    command: 'npm run dev',
    body: 'Vite runs the sample as a SPA while you edit, so page changes feel immediate.',
  },
  {
    number: '02',
    title: 'Edit a page',
    command: 'src/pages/*.tsx',
    body: 'Each page is a plain component. Keep view code, layout, and copy close together.',
  },
  {
    number: '03',
    title: 'Keep the route map explicit',
    command: 'ssg.config.ts',
    body: 'The static route list mirrors the pages the sample site actually ships.',
  },
  {
    number: '04',
    title: 'Generate and preview',
    command: 'npm run generate && npm run preview',
    body: 'Render the site to dist/static and verify the production output before you ship it.',
  },
];

export default function Workflow() {
  return (
    <>
      <SectionHeader
        eyebrow="Workflow"
        title="The authoring loop stays short."
        description="This sample keeps the daily work obvious: edit a page, update the route map, generate static HTML, and preview the result."
        actions={
          <ActionRow>
            <Button asChild>
              <Link href="/content">See the route map</Link>
            </Button>
            <Button asChild>
              <Link href="/preview">Open the preview</Link>
            </Button>
          </ActionRow>
        }
      />

      <CardGrid>
        {steps.map((step) => (
          <Card eyebrow={step.number} title={step.title} description={step.body}>
            <p>
              <code>{step.command}</code>
            </p>
          </Card>
        ))}
      </CardGrid>

      <Card title="Why this feels good" description="There is no hidden router magic. The generated site and the dev server read the same route definitions, so the UI you edit is the UI you ship.">
        <p>
          <code>npm run dev</code>, <code>npm run generate</code>, and{' '}
          <code>npm run preview</code> are the only commands you need to remember.
        </p>
      </Card>
    </>
  );
}
