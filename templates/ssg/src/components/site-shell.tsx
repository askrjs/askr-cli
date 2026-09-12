import { Link } from '@askrjs/askr/router';
import { Block, Header } from '@askrjs/themes/components';
import { Container, Section, Stack } from '@askrjs/themes/components';
import { Nav, NavLink } from '@askrjs/themes/components';
import Badge from './badge';

export const navItems = [
  { href: '/', label: 'Home' },
  { href: '/workflow', label: 'Workflow' },
  { href: '/content', label: 'Content' },
  { href: '/preview', label: 'Preview' },
] as const;

export function SiteHeader() {
  return (
    <Header position="sticky">
      <Container size="xl" paddingY="md">
        <Block class="navbar-shell">
          <Block class="navbar-brand">
            <Link class="brand" href="/">
              <strong>{'{{appName}}'}</strong>
              <span>Static site generation sample</span>
            </Link>
          </Block>

          <Nav
            as="div"
            aria-label="Primary navigation"
            class="navbar-group"
            data-align="end"
          >
            {navItems.map((item) => (
              <NavLink href={item.href}>{item.label}</NavLink>
            ))}
          </Nav>
        </Block>
      </Container>
    </Header>
  );
}

export function PageFrame({ children }: { children?: unknown }) {
  return (
    <Container size="xl" paddingY="2xl">
      <Stack gap="3xl">{children}</Stack>
    </Container>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: unknown;
}) {
  return (
    <Section class="section-header" paddingY="xl">
      <Block gap="md">
        <Stack gap="md" class="section-header-copy">
          <Badge>{eyebrow}</Badge>
          <h1>{title}</h1>
          <p class="section-header-description">{description}</p>
        </Stack>

        {actions ?? null}
      </Block>
    </Section>
  );
}

export function CardGrid({ children }: { children?: unknown }) {
  return <Block class="card-grid">{children}</Block>;
}

export function Card({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: unknown;
}) {
  return (
    <Block class="card">
      <Stack gap="md">
        {eyebrow ? <Badge>{eyebrow}</Badge> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {children}
      </Stack>
    </Block>
  );
}

export function ActionRow({ children }: { children?: unknown }) {
  return <Block class="action-row">{children}</Block>;
}
