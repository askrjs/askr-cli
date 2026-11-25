import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "@askrjs/askr/testing";
import { fetchUser } from "../src/resources/user";

describe("SSG Resources", () => {
  afterEach(() => vi.useRealTimers());

  it("should publish loaded user data to a rendered consumer", async () => {
    vi.useFakeTimers();
    const view = render(() => {
      const user = fetchUser(9);
      const status = () => (user.pending ? "Loading user" : (user.value?.name ?? "No user"));
      return <output>{status}</output>;
    });
    try {
      expect(view.root.textContent).toBe("Loading user");
      await vi.advanceTimersByTimeAsync(100);
      view.flush();
      expect(view.root.textContent).toBe("User 9");
    } finally {
      view.cleanup();
    }
  });
});
