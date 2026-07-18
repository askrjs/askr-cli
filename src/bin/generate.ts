import { generate } from "../generate/generator";
type Io = Pick<Console, "error" | "log">;
export async function runGenerateCli(args: string[], io: Io = console): Promise<number> {
  let output: string | undefined;
  let check = false;
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--check") check = true;
    else if (arg === "-o" || arg === "--output") output = args[++i];
    else if (arg.startsWith("--output=")) output = arg.slice(9);
    else if (arg.startsWith("-")) {
      io.error(`Unknown option: ${arg}`);
      return 1;
    } else inputs.push(arg);
  }
  if (inputs.length !== 1 || !output) {
    io.error("Usage: askr generate <input> -o <output-directory> [--check]");
    return 1;
  }
  try {
    await generate(inputs[0]!, output, check);
    io.log(check ? "Generated client is current." : `Generated client in ${output}.`);
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
