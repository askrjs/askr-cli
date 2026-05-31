import { state, derive } from '@askrjs/askr';
import { Button } from '@askrjs/ui';
import { Box, Stack } from '@askrjs/themes/layouts';
import Badge from './badge';

export default function Counter() {
  const [count, setCount] = state(0);
  const parity = derive(() => (count() % 2 === 0 ? 'even' : 'odd'));

  return (
    <Box class="card counter">
      <Stack gap="3">
        <h2>Hydration check</h2>
        <p class="text-muted">
          This counter should still feel live after static generation.
        </p>
        <div class="counter-value">{count()}</div>
        <div>
          <Badge>{parity()}</Badge>
        </div>
        <div class="counter-controls">
          <Button onPress={() => setCount((c) => Math.max(0, c - 1))}>
            - Decrement
          </Button>
          <Button onPress={() => setCount((c) => c + 1)}>+ Increment</Button>
        </div>
      </Stack>
    </Box>
  );
}
