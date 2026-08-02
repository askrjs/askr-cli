import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DocumentRenderArgs } from '@askrjs/askr/ssg';
import { withThemeStyles } from '@askrjs/themes/ssr';
import { pageRegistry } from './src/routes';

export const outputDir = './dist';
export const siteUrl = 'https://example.com';

let clientTemplate: string | undefined;

function renderDocument({ appHtml }: DocumentRenderArgs) {
  clientTemplate ??= readFileSync(
    resolve(process.cwd(), '.askr/client/index.html'),
    'utf8'
  );

  const appRoot = /<div([^>]*\bid=["']app["'][^>]*)>\s*<\/div>/i;
  if (!appRoot.test(clientTemplate)) {
    throw new Error('Built client template must contain an empty #app root.');
  }

  return clientTemplate.replace(appRoot, `<div$1>${appHtml}</div>`);
}

export const staticConfig = {
  registry: pageRegistry,
  outputDir,
  siteUrl,
  sitemap: {
    routes: {
      '/preview': false,
    },
  },
  document: withThemeStyles(renderDocument),
  styleRegistrationValidation: 'error' as const,
  assets: [
    {
      from: resolve(process.cwd(), '.askr/client/assets'),
      to: 'assets',
    },
  ],
};
