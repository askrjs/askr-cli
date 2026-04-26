import { group, registerRoutes, route } from '@askrjs/askr/router';
import AppLayout from './app';
import Home from './pages/home';
import About from './pages/about';
import Components from './pages/components';
import Charts from './pages/charts';

registerRoutes(() => {
  group({ layout: AppLayout }, () => {
    route('/', Home);
    route('/about', About);
    route('/components', Components);
    route('/charts', Charts);
  });
});
