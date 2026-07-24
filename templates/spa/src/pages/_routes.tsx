import { createRouteRegistry, fallback, group } from '@askrjs/askr/router';
import RootLayout from './_layout';
import AuthLayout from './auth/_layout';
import { registerAuthRoutes } from './auth/_routes';
import { registerAppRoutes } from './app/_routes';
import AppLayout from './app/_layout';
import NotFoundPage from './not-found';
import { registerPublicRoutes } from './public/_routes';
import PublicLayout from './public/_layout';

export const pageRegistry = createRouteRegistry(() => {
  group({ layout: RootLayout }, () => {
    group({ layout: PublicLayout }, () => {
      registerPublicRoutes();
    });

    group({ layout: AuthLayout }, () => {
      registerAuthRoutes();
    });

    group({ layout: AppLayout }, () => {
      registerAppRoutes();
    });

    fallback(NotFoundPage);
  });
});
