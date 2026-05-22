import { fallback, group, registerRoutes } from "@askrjs/askr/router";
import RootLayout from "./_layout";
import { registerAppRoutes } from "./app/_routes";
import AppLayout from "./app/_layout";
import NotFoundPage from "./not-found";
import { registerPublicRoutes } from "./public/_routes";
import PublicLayout from "./public/_layout";

registerRoutes(() => {
  group({ layout: RootLayout }, () => {
    group({ layout: PublicLayout }, () => {
      registerPublicRoutes();
    });

    group({ layout: AppLayout }, () => {
      registerAppRoutes();
    });

    fallback(NotFoundPage);
  });
});
