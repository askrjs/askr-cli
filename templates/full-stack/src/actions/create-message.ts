import { defineAction } from "@askrjs/askr/actions";
import { MessageInput } from "../schemas";

export const createMessageActionRoute = "/";

export const createMessageAction = defineAction({
  id: "create-message",
  input: MessageInput,
  invalidates: ["messages"],
});
