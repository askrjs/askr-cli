import { BarChart3Icon, CompassIcon, PaletteIcon } from '@askrjs/askr-lucide';
import FeatureCard from '../components/feature-card';

export default function About() {
  return (
    <>
      <section class="marketing-hero">
        <p class="marketing-eyebrow">About this app</p>
        <h1>A starter-sized demo, not a framework tour.</h1>
        <p class="marketing-lead text-muted">
          The goal is to show how an Askr app can feel cohesive with a small set
          of routes, components, and charts.
        </p>
      </section>

      <section class="marketing-section">
        <div class="page-header-copy">
          <p class="marketing-eyebrow">Design direction</p>
          <h2>Keep the pages useful, then stop.</h2>
          <p class="text-muted">
            Each page demonstrates one narrow idea instead of trying to document
            every feature in the workspace.
          </p>
        </div>

        <div class="marketing-card-grid">
          <FeatureCard icon={<CompassIcon size={16} />} title="Focused scope">
            Four routes keep the navigation clear and the content intentionally
            small.
          </FeatureCard>
          <FeatureCard icon={<PaletteIcon size={16} />} title="Shared shell">
            askr-themes provides the structure so the app can stay visually
            consistent.
          </FeatureCard>
          <FeatureCard icon={<BarChart3Icon size={16} />} title="Real packages">
            The demos use the actual askr-ui and askr-charts packages from this
            workspace.
          </FeatureCard>
        </div>
      </section>

      <section class="marketing-section">
        <div class="panel showcase-section">
          <h3>What this app is not</h3>
          <p class="marketing-lead text-muted">
            It is not a component catalog, a style guide, or a complete charting
            showcase.
          </p>
          <p>
            The pages are here to prove the app shape: landing copy, a few
            reactive controls, and interactive charts that still feel
            lightweight.
          </p>
        </div>
        </p>
      </section>
    </>
  );
}