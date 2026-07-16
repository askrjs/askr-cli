import type { InferSchema } from '@askrjs/schema';
import { createMessageAction } from '../../actions/create-message';
import type { AppDependencies } from '../dependencies';

type Input = InferSchema<typeof createMessageAction.input>;

export async function createMessage(
  _context: unknown,
  input: Input,
  deps: Pick<AppDependencies, 'actions'>,
) {
  await deps.actions.record({ action: createMessageAction.id, value: input.value });
  return { result: { accepted: true } };
}
