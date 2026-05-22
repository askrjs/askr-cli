import { route } from "@askrjs/askr/router";
import AdminLoginPage from "./admin-login";
import HomePage from "./home";

export function registerPublicRoutes(): void {
  route("/", HomePage);
  route("/admin-login", AdminLoginPage);
}
