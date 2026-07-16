import { defineServerActions, handleAction } from '@askrjs/server/askr';
import { createMessageAction } from '../actions/create-message';
import { createMessage } from './actions/create-message';
import type { AppDependencies } from './dependencies';

export function createActions(deps: AppDependencies) {
  return defineServerActions({ dependencies: deps,
    csrf: { secret: process.env.CSRF_SECRET ?? 'development-only-secret' },
  }, handleAction(createMessageAction, createMessage));
}
