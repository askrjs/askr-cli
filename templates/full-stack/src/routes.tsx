import { createRouteRegistry, group, route } from '@askrjs/askr/router';
import { actionsFor } from './action-authorizations';
import { AppLayout } from './pages/layout';
import { HomePage } from './pages/home';
import { NotFoundPage } from './pages/not-found';

export const pageRegistry = createRouteRegistry(() => {
  group({ layout: AppLayout }, () => {
    route('/', HomePage, {
      actions: actionsFor('/'),
      meta: {
        title: '{{appName}}',
        description: 'A progressive full-stack Askr application.',
        html: { lang: 'en', dir: 'ltr' },
      },
    });
    route('/*', NotFoundPage);
  });
});

