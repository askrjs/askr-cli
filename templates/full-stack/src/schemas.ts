import { schema } from '@askrjs/schema';

export const MessageInput = schema.object({
  value: schema.string({ minLength: 1, maxLength: 200 }),
});

export const Message = schema.object({
  id: schema.string(),
  value: schema.string(),
});

