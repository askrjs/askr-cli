import type { JSXElement } from '@askrjs/askr';
import IconLabel from './icon-label';

type FeatureCardProps = {
  icon: JSXElement;
  title: unknown;
  children?: unknown;
};

export default function FeatureCard({
  icon,
  title,
  children,
}: FeatureCardProps) {
  return (
    <div class="feature-card">
      <h3>
        <IconLabel icon={icon}>{title}</IconLabel>
      </h3>
      <p>{children}</p>
    </div>
  );
}
