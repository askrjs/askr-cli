import { createRouteRegistry, group, route } from '@askrjs/askr/router';
import AppLayout from './app';
import Home from './pages/home';
import Workflow from './pages/about';
import Content from './pages/content';
import Preview from './pages/example';

export const pageRegistry = createRouteRegistry(() => {
  group({ layout: AppLayout }, () => {
    route('/', Home);
    route('/workflow', Workflow);
    route('/content', Content);
    route('/preview', Preview);
  });
});
