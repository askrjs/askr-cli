import { derive, state } from '@askrjs/askr';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Flex,
} from '@askrjs/askr-themes/components';

export default function Counter() {
  const count = state(0);
  const parity = derive(() => (count() % 2 === 0 ? 'even' : 'odd'));

  return (
    <Card class="counter" variant="raised">
      <CardHeader class="counter__header">
        <p class="marketing-eyebrow">Reactive state</p>
        <CardTitle>One value, one derived label.</CardTitle>
        <CardDescription>
          <code>state()</code> drives the count. <code>derive()</code> keeps
          parity current.
        </CardDescription>
      </CardHeader>
      <CardContent class="counter__body">
        <div class="counter-value">{count()}</div>
        <p class="counter-parity text-bold">{parity()}</p>
        <Flex wrap="wrap" class="counter-controls">
          <Button
            variant="secondary"
            onPress={() => count.set((value) => Math.max(0, value - 1))}
          >
            -
          </Button>
          <Button
            variant="primary"
            onPress={() => count.set((value) => value + 1)}
          >
            +
          </Button>
        </Flex>
      </CardContent>
    </Card>
  );
}
