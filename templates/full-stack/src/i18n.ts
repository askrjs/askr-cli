import { createI18n } from '@askrjs/i18n';

export const messages = createI18n('en', {
  en: {
    title: () => '{{appName}}',
    intro: () => 'A progressive full-stack Askr application.',
  },
});
