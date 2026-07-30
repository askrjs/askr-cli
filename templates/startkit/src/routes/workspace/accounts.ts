import { lazy, route } from '@askrjs/askr/router';

const AccountsPage = lazy(() => import('../../pages/workspace/accounts'));

export function registerAccountRoutes(): void {
  route('/accounts', AccountsPage);
}
