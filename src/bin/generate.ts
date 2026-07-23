import { generate } from "../generate/generator";
type Io = Pick<Console, "error" | "log">;
export async function runGenerateCli(args: string[], io: Io = console): Promise<number> {
  const wantsJson = args.includes("--json");
  let output: string | undefined;
  let check = false;
  let json = false;
  let help = false;
  const allowedReferenceOrigins: string[] = [];
  const referenceLimits: {
    timeoutMs?: number;
    maxBytes?: number;
    maxDepth?: number;
    maxRedirects?: number;
  } = {};
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--check") check = true;
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--allow-ref-origin") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        const message = `${arg} requires an HTTPS origin`;
        io.error(wantsJson ? JSON.stringify({ status: "error", error: message }) : message);
        return 1;
      }
      allowedReferenceOrigins.push(value);
      i += 1;
    } else if (arg.startsWith("--allow-ref-origin=")) {
      allowedReferenceOrigins.push(arg.slice("--allow-ref-origin=".length));
    } else if (
      arg === "--ref-timeout-ms" ||
      arg === "--ref-max-bytes" ||
      arg === "--ref-max-depth" ||
      arg === "--ref-max-redirects"
    ) {
      const value = args[i + 1];
      const parsed = Number(value);
      if (!value || value.startsWith("-") || !Number.isSafeInteger(parsed) || parsed <= 0) {
        const message = `${arg} requires a positive safe integer`;
        io.error(wantsJson ? JSON.stringify({ status: "error", error: message }) : message);
        return 1;
      }
      const key = {
        "--ref-timeout-ms": "timeoutMs",
        "--ref-max-bytes": "maxBytes",
        "--ref-max-depth": "maxDepth",
        "--ref-max-redirects": "maxRedirects",
      }[arg] as keyof typeof referenceLimits;
      referenceLimits[key] = parsed;
      i += 1;
    } else if (/^--ref-(?:timeout-ms|max-bytes|max-depth|max-redirects)=/.test(arg)) {
      const [flag, value = ""] = arg.split("=", 2);
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        const message = `${flag} requires a positive safe integer`;
        io.error(wantsJson ? JSON.stringify({ status: "error", error: message }) : message);
        return 1;
      }
      const key = {
        "--ref-timeout-ms": "timeoutMs",
        "--ref-max-bytes": "maxBytes",
        "--ref-max-depth": "maxDepth",
        "--ref-max-redirects": "maxRedirects",
      }[flag] as keyof typeof referenceLimits;
      referenceLimits[key] = parsed;
    } else if (arg === "-o" || arg === "--output") {
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
  const usage =
    "Usage: askr generate <input> -o <output-directory> [--check] [--json] [--allow-ref-origin <https-origin>] [--ref-timeout-ms <n>] [--ref-max-bytes <n>] [--ref-max-depth <n>] [--ref-max-redirects <n>]";
  if (help) {
    io.log(usage);
    return 0;
  }
  if (inputs.length !== 1 || !output) {
    io.error(json ? JSON.stringify({ status: "error", error: usage }) : usage);
    return 1;
  }
  try {
    await generate(inputs[0]!, output, check, {
      allowedReferenceOrigins,
      ...referenceLimits,
    });
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
