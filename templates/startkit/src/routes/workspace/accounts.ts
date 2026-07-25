import { lazy, route } from '@askrjs/askr/router';
import { accountsRoute } from '../../lib/routes';

export function registerAccountRoutes(): void {
  route(
    accountsRoute.href,
    lazy(() => import('../../pages/workspace/accounts'))
  );
}
