import { describe, it, expect } from "vite-plus/test";

describe("App Component", () => {
  it("renders layout with navigation and a theme toggle", () => {
    const app = `
      <div data-slot="theme-provider" data-theme="light">
        <header data-slot="header">
          <div data-slot="container">
            <nav data-slot="navbar">
              <div data-slot="nav-brand">
                <a href="/">
                  <strong>sample-spa</strong>
                </a>
              </div>
              <div data-slot="nav-group">
                <a href="/about">About</a>
                <a href="/components">Components</a>
                <a href="/charts">Charts</a>
              </div>
              <div data-slot="nav-group">
                <a href="https://github.com/askrjs" aria-label="GitHub repository"></a>
                <button data-theme-control="toggle" aria-label="Toggle color theme"></button>
              </div>
            </nav>
          </div>
        </header>
        <main>
          <div data-slot="container">
            <p>Content goes here</p>
          </div>
        </main>
        <footer class="site-footer">
          <div data-slot="container">
            <div data-slot="grid"></div>
          </div>
        </footer>
      </div>
    `;

    expect(app).toContain('data-slot="theme-provider"');
    expect(app).toContain('data-theme-control="toggle"');
    expect(app).toContain('data-slot="navbar"');
    expect(app).toContain('href="/components"');
    expect(app).toContain('href="/charts"');
    expect(app).toContain('class="site-footer"');
  });
});
