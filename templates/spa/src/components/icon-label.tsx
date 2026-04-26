type IconLabelProps = {
  icon: unknown;
  children?: unknown;
  compact?: boolean;
};

export default function IconLabel({
  icon,
  children,
  compact = false,
}: IconLabelProps) {
  return (
    <span class={compact ? 'icon-label icon-label--compact' : 'icon-label'}>
      {icon}
      <span class="icon-label__text">{children}</span>
    </span>
  );
}
