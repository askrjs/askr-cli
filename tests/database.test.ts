import { describe, expect, it, vi } from "vitest";
import {
  loadOrmTooling,
  type OrmTooling,
  runDatabaseCommand,
  runDatabaseValidation,
} from "../src/bin/database";

function io() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    value: {
      log: (...values: unknown[]) => logs.push(values.join(" ")),
      error: (...values: unknown[]) => errors.push(values.join(" ")),
    },
    logs,
    errors,
  };
}

type Loader = typeof loadOrmTooling;

describe("database command routing", () => {
  it("should forward all semantics to the project-installed ORM tooling", async () => {
    const output = io();
    const runDatabaseCli = vi.fn(async () => 0);
    const loader: Loader = vi.fn(async () => ({ runDatabaseCli }));

    await expect(
      runDatabaseCommand(
        ["migration", "plan", "--database", "accounts"],
        output.value,
        "/project",
        loader,
      ),
    ).resolves.toBe(0);
    expect(loader).toHaveBeenCalledWith("/project");
    expect(runDatabaseCli).toHaveBeenCalledWith(["migration", "plan", "--database", "accounts"], {
      cwd: "/project",
      io: output.value,
    });
  });

  it("should report a focused install error when tooling is unavailable", async () => {
    const output = io();
    const loader: Loader = vi.fn(async () => {
      throw new Error("missing");
    });
    expect(await runDatabaseCommand(["validate"], output.value, "/project", loader)).toBe(1);
    expect(output.errors).toEqual(["missing"]);
  });

  it("should capture lazy validation output for askr check", async () => {
    const loader: Loader = vi.fn(async () => ({
      runDatabaseCli: async (
        _args: readonly string[],
        options: Parameters<OrmTooling["runDatabaseCli"]>[1],
      ) => {
        options.io.log("valid");
        return 0;
      },
    }));
    await expect(runDatabaseValidation("/project", loader)).resolves.toEqual({
      status: "passed",
      exitCode: 0,
      stdout: "valid",
      stderr: "",
    });
  });
});
