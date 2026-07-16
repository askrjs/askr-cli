import { createActionRegistry } from '@askrjs/server/askr';
import { createMessageAction } from '../actions/create-message';
import { createMessage } from './actions/create-message';
import type { AppDependencies } from './dependencies';

export function createActions(deps: AppDependencies) {
  const registry = createActionRegistry(deps, {
    csrf: { secret: process.env.CSRF_SECRET ?? 'development-only-secret' },
  });
  registry.register(createMessageAction, createMessage);
  return registry;
}
