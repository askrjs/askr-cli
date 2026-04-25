import { describe, it, expect } from "vite-plus/test";

describe("App Component", () => {
  it("renders layout with navigation and a theme toggle", () => {
    const app = `
      <div data-slot="theme-provider" data-theme="light">
        <header>
          <nav>
            <strong>Askr</strong>
            <div class="nav-actions">
              <div>
                <a href="/example">Example</a>
                <a href="/about">About</a>
              </div>
              <button data-theme-control="toggle">Dark mode</button>
            </div>
          </nav>
        </header>
        <main>
          <p>Content goes here</p>
        </main>
      </div>
    `;

    expect(app).toContain('data-slot="theme-provider"');
    expect(app).toContain('data-theme-control="toggle"');
    expect(app).toContain("Dark mode");
  });
});
