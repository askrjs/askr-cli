import { MoonIcon, SunIcon } from "@askrjs/lucide";
import { Link } from "@askrjs/askr/router";
import {
  Badge,
  Container,
  Flex,
  GitHubLogo,
  Grid,
  Header,
  NavBrand,
  Navbar,
  NavGroup,
  NavLink,
  Separator,
  Stack,
  ThemeProvider,
  ThemeToggle,
} from "@askrjs/themes/components";

export default function App({ children }: { children?: unknown }) {
  const year = new Date().getFullYear();

  return (
    <ThemeProvider defaultTheme="light">
      <Header position="sticky">
        <Container>
          <Navbar aria-label="Primary">
            <NavBrand>
              <Link href="/">
                <strong>{"{{appName}}"}</strong>
              </Link>
            </NavBrand>
            <NavGroup data-align="center">
              <NavLink href="/components">Components</NavLink>
              <NavLink href="/charts">Charts</NavLink>
              <NavLink href="/about">About</NavLink>
            </NavGroup>
            <NavGroup data-align="end">
              <a href="https://github.com/askrjs" aria-label="GitHub repository">
                <GitHubLogo size={20} />
              </a>
              <ThemeToggle
                variant="ghost"
                size="icon"
                toggleThemes={["light", "dark"]}
                aria-label="Toggle color theme"
                lightIcon={<SunIcon size={20} aria-hidden="true" />}
                darkIcon={<MoonIcon size={20} aria-hidden="true" />}
              />
            </NavGroup>
          </Navbar>
        </Container>
      </Header>
      <main>
        <Container>{children}</Container>
      </main>
      <footer class="site-footer">
        <Container>
          <Grid gap="lg" align="start">
            <Stack gap="md">
              <p class="text-bold text-muted">Askr ecosystem</p>
              <Link href="/" class="text-bold">
                <strong>{"{{appName}}"}</strong>
              </Link>
              <p class="text-muted">
                Fast, composable UI foundations for building apps, charts, and
                themed interfaces with a small, coherent surface area.
              </p>
              <Flex wrap="wrap" gap="sm" aria-label="Core packages">
                <Badge class="gap-1">askr</Badge>
                <Badge class="gap-1">askr-ui</Badge>
                <Badge class="gap-1">askr-themes</Badge>
                <Badge class="gap-1">askr-charts</Badge>
              </Flex>
            </Stack>

            <Stack gap="sm">
              <h3 class="text-bold">Explore</h3>
              <Stack asChild gap="none">
                <nav aria-label="Footer explore">
                  <Link href="/components">Components</Link>
                  <Link href="/charts">Charts</Link>
                  <Link href="/about">About</Link>
                </nav>
              </Stack>
            </Stack>

            <Stack gap="sm">
              <h3 class="text-bold">Project</h3>
              <Stack asChild gap="none">
                <nav aria-label="Footer project">
                  <a
                    href="https://github.com/askrjs"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub
                  </a>
                  <a
                    href="https://www.npmjs.com/search?q=%40askrjs"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Packages
                  </a>
                  <a
                    href="https://github.com/askrjs/repositories"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Repositories
                  </a>
                </nav>
              </Stack>
            </Stack>
          </Grid>

          <Separator decorative />

          <Flex wrap="wrap" class="text-muted" justify="between" gap="sm">
            <span>Built with Askr.</span>
            <span>&copy; {year} {"{{appName}}"}.</span>
          </Flex>
        </Container>
      </footer>
    </ThemeProvider>
  );
}

