import { runCreateCli } from "../../src/bin/create";

process.exit(await runCreateCli(["spa", "test-app", "--dir", process.argv[2], "--no-skills"]));
