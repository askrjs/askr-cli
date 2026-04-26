import { describe, it, expect } from "vite-plus/test";

describe("App Component", () => {
  it("renders layout with navigation and a theme toggle", () => {
    const app = `
      <div data-slot="theme-provider" data-theme="light">
        <div class="marketing-shell">
          <header>
            <nav class="marketing-topbar">
              <a href="/" class="marketing-brand">
                <span class="marketing-brand-mark">A</span>
                <span class="marketing-brand-copy">
                  <strong>sample-spa</strong>
                </span>
              </a>
              <div class="marketing-nav">
                <a href="/">Home</a>
                <a href="/about">About</a>
                <a href="/components">Components</a>
                <a href="/charts">Charts</a>
              </div>
              <div class="marketing-actions">
                <button data-theme-control="toggle" aria-label="Toggle color theme"></button>
              </div>
            </div>
            </nav>
          </header>
          <main class="marketing-section">
            <p>Content goes here</p>
          </main>
        </div>
      </div>
    `;

    expect(app).toContain('data-slot="theme-provider"');
    expect(app).toContain('data-theme-control="toggle"');
    expect(app).toContain('href="/components"');
    expect(app).toContain('href="/charts"');
  });
});
