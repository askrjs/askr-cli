export default function Badge({
  children,
}: {
  children?: unknown;
}) {
  return <span class="badge">{children}</span>;
}