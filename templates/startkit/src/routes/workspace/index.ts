import { lazy, route } from '@askrjs/askr/router';
import { registerAccountRoutes } from './accounts';

const DashboardPage = lazy(() => import('../../pages/workspace/dashboard'));
const SettingsPage = lazy(() => import('../../pages/workspace/settings'));

export function registerWorkspaceRoutes(): void {
  route('/dashboard', DashboardPage);
  registerAccountRoutes();
  route('/settings', SettingsPage);
}
