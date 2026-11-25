import { renderToString } from "@askrjs/askr/ssr";
import { describe, expect, it } from "vite-plus/test";
import App from "../src/app";

describe("App layout", () => {
  it("should render the shipped navigation links with their destinations", () => {
    const document = new DOMParser().parseFromString(
      renderToString(() => <App />),
      "text/html",
    );
    const links = Array.from(document.querySelectorAll("nav a"), (link) => [
      link.textContent?.trim(),
      link.getAttribute("href"),
    ]);

    expect(links).toEqual([
      ["{{appName}}", "/"],
      ["Example", "/example"],
      ["About", "/about"],
    ]);
  });
});
