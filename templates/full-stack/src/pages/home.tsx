import { ActionForm } from '@askrjs/askr/actions';
import { createMessageAction } from '../actions/create-message';
import { messages } from '../i18n';

export function HomePage() {
  return (
    <main>
      <h1>{messages.text('title')}</h1>
      <p>{messages.text('intro')}</p>
      <form method="post" action="/api/session">
        <button type="submit">Start demo session</button>
      </form>
      {ActionForm({
        action: createMessageAction,
        children: (
          <>
            <label htmlFor="message">Message</label>
            <input id="message" name="value" required />
            <button type="submit">Create message</button>
          </>
        ),
      })}
    </main>
  );
}
