import { fallback, group, lazy } from '@askrjs/askr/router';
import { requireAnonymous, requireUser } from '@askrjs/auth';
import App from '../pages/_layout';
import AuthLayout from '../pages/auth/_layout';
import AppLayout from '../pages/workspace/_layout';
import { registerAuthRoutes } from './auth';
import { registerPublicRoutes } from './public';
import { registerWorkspaceRoutes } from './workspace';

const NotFoundPage = lazy(() => import('../pages/not-found'));

export function registerAppRoutes(): void {
  group({ layout: App }, () => {
    registerPublicRoutes();

    group({ layout: AuthLayout, auth: requireAnonymous() }, () => {
      registerAuthRoutes();
    });

    group({ layout: AppLayout, auth: requireUser() }, () => {
      registerWorkspaceRoutes();
    });

    fallback(NotFoundPage);
  });
}

export { registerAuthRoutes } from './auth';
export { registerPublicRoutes } from './public';
export { registerWorkspaceRoutes } from './workspace';
