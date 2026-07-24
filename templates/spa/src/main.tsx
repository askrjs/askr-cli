import { createSPA } from '@askrjs/askr/boot';
import { pageRegistry } from './pages/_routes';

import './styles.css';

await createSPA({
  root: document.getElementById('app')!,
  registry: pageRegistry,
});
