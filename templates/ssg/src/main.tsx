import './styles.css';
import { createSPA } from '@askrjs/askr/boot';
import { pageRegistry } from './routes';

await createSPA({
  root: document.getElementById('app')!,
  registry: pageRegistry,
});
