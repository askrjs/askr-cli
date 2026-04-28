import { ArrowRightIcon } from '@askrjs/askr-lucide/icons/arrow-right';
import { BarChart3Icon } from '@askrjs/askr-lucide';
import { BoxesIcon } from '@askrjs/askr-lucide';
import { LayoutTemplateIcon } from '@askrjs/askr-lucide';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Grid,
  Section,
} from '@askrjs/askr-themes/components';
import FeatureCard from '../components/feature-card';
import Hero, {
  HeroActions,
  HeroButton,
  HeroDescription,
  HeroEyebrow,
  HeroTitle,
} from '../components/hero';

export default function Home() {
  return (
    <>
      <Hero>
        <div class="home-hero">
          <div class="home-hero__content">
            <HeroEyebrow class="home-kicker">Build the app shape first</HeroEyebrow>
            <HeroTitle>Components, charts, and theming that already feel like one product.</HeroTitle>
            <HeroDescription>
              {"{{appName}}"} is a compact Askr app shell with a real landing flow, a
              focused component page, and interactive charts that prove the
              packages work together without turning into a giant demo site.
            </HeroDescription>
            <HeroActions class="home-hero__actions">
              <HeroButton href="/components" variant="primary">
                Explore components <ArrowRightIcon size={16} />
              </HeroButton>
              <HeroButton href="/charts" variant="secondary">
                <BarChart3Icon size={16} /> See charts
              </HeroButton>
            </HeroActions>
          </div>

          <Card class="home-hero__artifact" variant="raised">
            <CardHeader class="home-hero__artifact-copy">
              <p class="home-kicker">Example stack</p>
              <CardTitle>One shell, three surfaces.</CardTitle>
              <CardDescription>
                A predictable app frame with routes for components, charting,
                and lightweight product copy.
              </CardDescription>
            </CardHeader>
            <CardContent class="home-hero__artifact-grid">
              <div class="home-hero__artifact-item">
                <strong>Components</strong>
                <span>Accessible primitives with theme-level polish.</span>
              </div>
              <div class="home-hero__artifact-item">
                <strong>Charts</strong>
                <span>Interactive data views with a restrained API.</span>
              </div>
              <div class="home-hero__artifact-item">
                <strong>Themes</strong>
                <span>Layout, shell, and content patterns that stay coherent.</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </Hero>

      <Section>
        <div class="page-header home-section-head">
          <div class="page-header-copy">
            <p class="home-kicker">What you can explore</p>
            <h2>Three focused surfaces instead of one overloaded showcase.</h2>
            <p class="text-muted">
              The structure stays simple: one clear landing page, one component
              page, and one chart page with enough interactivity to feel real.
            </p>
          </div>
        </div>

        <div class="home-card-grid">
          <FeatureCard
            icon={<LayoutTemplateIcon size={16} />}
            title="Themed app shell"
          >
            Header, container rhythm, section spacing, and footer composition
            give the app a stable frame before individual pages get fancy.
          </FeatureCard>
          <FeatureCard icon={<BoxesIcon size={16} />} title="Components">
            Focus on a narrow set of primitives and patterns instead of turning
            the app into a complete catalog.
          </FeatureCard>
          <FeatureCard icon={<BarChart3Icon size={16} />} title="Charts">
            Show interactive data views with enough controls to prove the
            runtime, without drifting into dashboard sprawl.
          </FeatureCard>
        </div>
      </Section>

      <Section>
        <div class="page-header home-section-head">
          <div class="page-header-copy">
            <p class="home-kicker">How it flows</p>
            <h2>A calm sequence with one idea per section.</h2>
          </div>
        </div>

        <Grid minItemWidth="14rem" gap="4">
          <Card class="home-step" variant="raised">
            <span class="home-step__number">01</span>
            <CardTitle>Start with the frame</CardTitle>
            <CardDescription>
              The shell establishes hierarchy fast so every route feels like it
              belongs to the same product.
            </CardDescription>
          </Card>
          <Card class="home-step" variant="raised">
            <span class="home-step__number">02</span>
            <CardTitle>Show one capability clearly</CardTitle>
            <CardDescription>
              Each page demonstrates a narrow slice instead of forcing every
              feature into the hero.
            </CardDescription>
          </Card>
          <Card class="home-step" variant="raised">
            <span class="home-step__number">03</span>
            <CardTitle>End with a clear next move</CardTitle>
            <CardDescription>
              Components, charts, and about all lead naturally to the next
              useful surface.
            </CardDescription>
          </Card>
        </Grid>
      </Section>

      <Section>
        <Card class="home-proof" variant="raised">
          <div class="home-proof__copy">
            <p class="home-kicker">Why this shape works</p>
            <h2>
              Enough product structure to feel intentional, not enough to feel
              bloated.
            </h2>
            <p class="text-muted">
              The app stays small, but the layout gives it momentum: strong
              entry, useful middle, and a clear sense of where to go next.
            </p>
          </div>
          <div class="home-proof__stats">
            <div class="home-proof__stat">
              <strong>4</strong>
              <span>focused routes</span>
            </div>
            <div class="home-proof__stat">
              <strong>3</strong>
              <span>workspace packages in play</span>
            </div>
            <div class="home-proof__stat">
              <strong>1</strong>
              <span>shared shell</span>
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <Card class="home-cta" variant="raised">
          <div class="home-cta__copy">
            <p class="home-kicker">Start somewhere concrete</p>
            <h2>Open the component demos, then look at the charts.</h2>
            <p class="text-muted">
              That path shows the app shell first, then the UI surface, then
              the data surface without making the landing page do all the work.
            </p>
          </div>
          <div class="home-cta__actions">
            <HeroButton href="/components" variant="primary">
              Go to components
            </HeroButton>
            <HeroButton href="/about" variant="ghost">
              Read about the app
            </HeroButton>
          </div>
        </Card>
      </Section>
    </>
  );
}
