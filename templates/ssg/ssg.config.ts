import type { RouteConfig } from '@askrjs/askr/ssg';
import { getManifest, registerRoutes } from '@askrjs/askr/router';
import { registerAppRoutes } from './src/routes';

registerRoutes(registerAppRoutes);

const manifest = getManifest();

export const routes: RouteConfig[] = manifest.records.map((record) => ({
  path: record.path,
  handler: record.handler,
  namespace: record.options.namespace,
  auth: record.options.auth,
  role: record.options.role,
  permission: record.options.permission,
  policies: record.options.policies,
  entries: record.options.entries,
}));

export const outputDir = './dist/static';
