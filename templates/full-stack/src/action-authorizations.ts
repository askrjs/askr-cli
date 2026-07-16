import type { ActionDescriptor } from '@askrjs/askr/actions';
import { createMessageAction } from './actions/create-message';

const actionsByRoute: Readonly<Record<string, readonly ActionDescriptor[]>> = Object.freeze({
  "/": [createMessageAction],
});

export function actionsFor(path: string): readonly ActionDescriptor[] {
  return actionsByRoute[path] ?? [];
}
