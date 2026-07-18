import { generate } from "../generate/generator";
type Io = Pick<Console, "error" | "log">;
export async function runGenerateCli(args: string[], io: Io = console): Promise<number> {
  const wantsJson = args.includes("--json");
  let output: string | undefined;
  let check = false;
  let json = false;
  let help = false;
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--check") check = true;
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "-o" || arg === "--output") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        const message = `${arg} requires a path`;
        io.error(wantsJson ? JSON.stringify({ status: "error", error: message }) : message);
        return 1;
      }
      output = value;
      i += 1;
    } else if (arg.startsWith("--output=")) output = arg.slice(9);
    else if (arg.startsWith("-")) {
      const message = `Unknown option: ${arg}`;
      io.error(wantsJson ? JSON.stringify({ status: "error", error: message }) : message);
      return 1;
    } else inputs.push(arg);
  }
  const usage = "Usage: askr generate <input> -o <output-directory> [--check] [--json]";
  if (help) {
    io.log(usage);
    return 0;
  }
  if (inputs.length !== 1 || !output) {
    io.error(json ? JSON.stringify({ status: "error", error: usage }) : usage);
    return 1;
  }
  try {
    await generate(inputs[0]!, output, check);
    io.log(
      json
        ? JSON.stringify({ status: "ok", action: check ? "checked" : "generated", output })
        : check
          ? "Generated client is current."
          : `Generated client in ${output}.`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(json ? JSON.stringify({ status: "error", error: message }) : message);
    return 1;
  }
}
