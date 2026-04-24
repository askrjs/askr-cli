import { Link } from '@askrjs/askr/router';
import { Button } from '@askrjs/askr-ui/primitives/button';
import { Badge } from '@askrjs/askr-ui/primitives/badge';
import { ArrowRightIcon } from '@askrjs/askr-lucide/icons/arrow-right';
import { BookOpenIcon } from '@askrjs/askr-lucide/icons/book-open';
import { Clock3Icon } from '@askrjs/askr-lucide/icons/clock3';
import { ShapesIcon } from '@askrjs/askr-lucide/icons/shapes';
import { SparklesIcon } from '@askrjs/askr-lucide/icons/sparkles';
import FeatureCard from '../components/feature-card';

export default function Home() {
  return (
    <>
      <section class="text-center section">
        <h1>Welcome to Askr</h1>
        <p class="text-muted">
          A minimalist reactive framework for modern web applications.
          Fine-grained reactivity, zero runtime dependencies, TypeScript-first.
        </p>
        <div class="hero-actions">
          <Button asChild>
            <Link href="/example">
              View Examples <ArrowRightIcon size={16} />
            </Link>
          </Button>
          <Button asChild>
            <Link href="/about">
              <BookOpenIcon size={16} /> Learn More
            </Link>
          </Button>
        </div>
      </section>

      <div class="features">
        <FeatureCard icon={<SparklesIcon size={16} />} title={<Badge>Reactive</Badge>}>
          <code>state()</code> and <code>derive()</code> give you fine-grained
          reactivity. Only the DOM nodes that depend on changed values update
          — nothing more.
        </FeatureCard>
        <FeatureCard icon={<Clock3Icon size={16} />} title={<Badge>Async</Badge>}>
          <code>resource()</code> handles data fetching with built-in loading
          states, error handling, and automatic refetching when dependencies
          change.
        </FeatureCard>
        <FeatureCard
          icon={<ShapesIcon size={16} />}
          title={<Badge>Composable</Badge>}
        >
          askr-ui provides headless components. askr-themes provides CSS
          themes. Mix and match — or build your own.
        </FeatureCard>
      </div>
    </>
  );
}
