import { lazy, route } from '@askrjs/askr/router';
import { dashboardRoute, settingsRoute } from '../../lib/routes';
import { registerAccountRoutes } from './accounts';

export function registerWorkspaceRoutes(): void {
  route(
    dashboardRoute.href,
    lazy(() => import('../../pages/workspace/dashboard'))
  );
  registerAccountRoutes();
  route(
    settingsRoute.href,
    lazy(() => import('../../pages/workspace/settings'))
  );
}
