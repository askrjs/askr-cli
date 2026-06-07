import { createStaticGen } from '@askrjs/askr/ssg';
import { routes, outputDir } from './ssg.config';

const ssg = createStaticGen({ routes, outputDir });
const result = await ssg.generate();

console.log(`Generated ${result.successful}/${result.totalRoutes} pages`);

if (result.failed > 0) {
  const failedRoutes = result.routes.filter(
    (route) => route.status === 'error'
  );

  console.error('Failed routes:');
  for (const route of failedRoutes) {
    console.error(`- ${route.path}: ${route.error ?? 'Unknown error'}`);
  }

  process.exit(1);
}
