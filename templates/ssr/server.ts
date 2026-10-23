import { fileURLToPath } from "node:url";
import { posix } from "node:path";
import { serve } from "@askrjs/node";
import app from "virtual:askr-server";

const port = Number(process.env.PORT ?? 3000);
const running = await serve(app, {
  host: process.env.HOST ?? "127.0.0.1",
  port,
  assets: {
    root: fileURLToPath(new URL("../", import.meta.url)),
    exclude: (pathname) => {
      const normalized = posix.normalize(pathname.replaceAll("\\", "/")).toLowerCase();
      return ["/server", "/.vite"].some(
        (directory) => normalized === directory || normalized.startsWith(`${directory}/`),
      );
    },
  },
});
console.log(`Server started at ${running.url}`);
