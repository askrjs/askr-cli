import type { RouteAuthOptions } from '@askrjs/askr/router';
import { getSessionEmail } from '../lib/mock-data';
import {
  dashboardRoute,
  loginRoute,
  normalizeProtectedRouteTarget,
} from '../lib/routes';

export const routeAuth: RouteAuthOptions = {
  resolve: () => {
    const email = getSessionEmail();

    if (!email) {
      return {
        authenticated: false,
        principal: null,
        session: null,
        tenant: null,
      };
    }

    const principal = { id: email, subject: email, email };
    const session = { id: `browser:${email}`, subject: email };

    return {
      authenticated: true,
      principal,
      session,
      tenant: null,
    };
  },
  loginPath: loginRoute.href,
  authenticatedRedirectTo: ({ search }) => {
    const nextTarget = new URLSearchParams(search).get('next');
    const resolvedTarget = normalizeProtectedRouteTarget(nextTarget);
    return resolvedTarget || dashboardRoute.href;
  },
};
