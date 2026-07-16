import { handleAction } from "@askrjs/server/askr";
import { createMessageAction } from "../actions/create-message";
import { createMessage } from "./actions/create-message";
import type { AppDependencies } from "./dependencies";

export function createActionHandlers() {
  return [handleAction(createMessageAction, createMessage)] as const;
}
