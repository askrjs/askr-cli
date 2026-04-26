import { state, derive } from '@askrjs/askr';
import { Button } from '@askrjs/askr-ui/primitives/button';

export default function Counter() {
  const count = state(0);
  const parity = derive(() => (count() % 2 === 0 ? 'even' : 'odd'));

  return (
    <div class="counter panel">
      <div class="counter__header">
        <p class="marketing-eyebrow">Reactive state</p>
        <h2>One value, one derived label.</h2>
        <p class="text-muted">
          <code>state()</code> drives the count. <code>derive()</code> keeps
          parity current.
        </p>
      </div>
      <div class="counter__body">
        <div class="counter-value">{count()}</div>
        <p class="counter-parity text-bold">{parity()}</p>
        <div class="counter-controls">
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
        </div>
      </div>
    </div>
  );
}
