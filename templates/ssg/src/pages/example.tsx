import { state } from '@askrjs/askr';
import { Link } from '@askrjs/askr/router';
import { Button, Input } from '@askrjs/ui';
import Counter from '../components/counter';
import {
  ActionRow,
  Card,
  CardGrid,
  SectionHeader,
} from '../components/site-shell';

const sampleUsers: Record<
  number,
  { name: string; email: string; note: string }
> = {
  1: {
    name: 'User 1',
    email: 'user1@example.com',
    note: 'Replace this with your own content or connect it to real data later.',
  },
  2: {
    name: 'User 2',
    email: 'user2@example.com',
    note: 'This stays simple on purpose so the starter remains easy to delete or extend.',
  },
  3: {
    name: 'User 3',
    email: 'user3@example.com',
    note: 'Interactive state still hydrates after static generation without adding async complexity.',
  },
};

export default function Preview() {
  const [userId, setUserId] = state(1);
  const user = sampleUsers[userId()] ?? {
    name: `User ${userId()}`,
    email: `user${userId()}@example.com`,
    note: 'Use this route as a safe place to try small interactive changes.',
  };

  return (
    <>
      <SectionHeader
        eyebrow="Preview"
        title="Interactive parts still work after static generation."
        description="Keep one page interactive so you can verify hydration, state, and resource loading without turning the template into an app."
        actions={
          <ActionRow>
            <Button asChild>
              <Link href="/workflow">Read the workflow</Link>
            </Button>
            <Button asChild>
              <Link href="/content">Review the routes</Link>
            </Button>
          </ActionRow>
        }
      />

      <CardGrid>
        <Counter />

        <Card
          eyebrow="Interactive state"
          title="State still hydrates after generation"
          description="Change the user id to prove the generated page still responds in the browser."
        >
          <div class="preview-controls">
            <Input
              type="number"
              min="1"
              step="1"
              value={String(userId())}
              onInput={(event: Event) => {
                const nextValue = Number.parseInt(
                  (event.target as HTMLInputElement).value,
                  10
                );

                setUserId(Number.isNaN(nextValue) ? 1 : Math.max(1, nextValue));
              }}
            />
          </div>

          <div class="resource-panel">
            <div class="resource-status">
              <span class="badge">Ready</span>
              <span>Hydrated preview</span>
            </div>
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            <p class="text-muted">{user.note}</p>
          </div>
        </Card>
      </CardGrid>
    </>
  );
}
