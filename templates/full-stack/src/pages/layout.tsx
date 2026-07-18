import { Link } from "@askrjs/askr/router";
import {
  Block,
  Container,
  Header,
  Navbar,
  NavBrand,
  NavGroup,
  NavLink,
} from "@askrjs/themes/components";
import { ThemeScope, ThemeToggle } from "@askrjs/themes/theme";
import { messages } from "../i18n";

function ScopedLayout({ children }: { children?: unknown }) {
  return (
    <ThemeScope defaultTheme="light" storageKey="{{appName}}-theme">
      <Block minHeight="screen">
        <Header sticky>
          <Container paddingY="sm">
            <Navbar aria-label="Primary navigation" width="full">
              <NavBrand>
                <Link href="/">{messages.text("title")}</Link>
              </NavBrand>
              <NavGroup align="end">
                <NavLink href="/">Home</NavLink>
                <ThemeToggle aria-label="Toggle theme" />
              </NavGroup>
            </Navbar>
          </Container>
        </Header>
        <Container paddingY="2xl">{children}</Container>
      </Block>
    </ThemeScope>
  );
}

export function AppLayout({ children }: { children?: unknown }) {
  return (
    <messages.Scope locale="en" dir="ltr">
      <ScopedLayout>{children}</ScopedLayout>
    </messages.Scope>
  );
}
