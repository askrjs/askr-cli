type FeatureCardProps = {
  icon: unknown;
  title: unknown;
  children?: unknown;
};

export default function FeatureCard({
  icon,
  title,
  children,
}: FeatureCardProps) {
  return (
    <article class="feature-card panel">
      <div class="feature-card__icon">{icon}</div>
      <div class="feature-card__copy">
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </article>
  );
}
