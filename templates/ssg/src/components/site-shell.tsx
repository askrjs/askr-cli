import { Link } from '@askrjs/askr/router';
import { Header } from '@askrjs/themes/components';
import {
  Block,
  Box,
  Container,
  Section,
  Stack,
} from '@askrjs/themes/components';
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
      <Container size="4" py="4">
        <Box class="navbar-shell">
          <Box class="navbar-brand">
            <Link class="brand" href="/">
              <strong>{'{{appName}}'}</strong>
              <span>Static site generation sample</span>
            </Link>
          </Box>

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
        </Box>
      </Container>
    </Header>
  );
}

export function PageFrame({ children }: { children?: unknown }) {
  return (
    <Container size="4" py="8">
      <Stack gap="8">{children}</Stack>
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
    <Section class="section-header" size="3">
      <Block gap="4">
        <Stack gap="3" class="section-header-copy">
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
  return <Box class="card-grid">{children}</Box>;
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
    <Box class="card">
      <Stack gap="3">
        {eyebrow ? <Badge>{eyebrow}</Badge> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {children}
      </Stack>
    </Box>
  );
}

export function ActionRow({ children }: { children?: unknown }) {
  return <Box class="action-row">{children}</Box>;
}
