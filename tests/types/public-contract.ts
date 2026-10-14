import type { SitemapConfig, SsgOutputReportConfig } from "@askrjs/cli/ssg";

const sitemap = {
  defaults: { changeFrequency: "weekly", priority: 0.5 },
  routes: { "/private": false, "/public": { lastModified: new Date(), alternates: { en: "/en" } } },
  async resolve(route) {
    return route.path === "/skip" ? false : { url: route.path };
  },
} satisfies SitemapConfig;
const outputReport = {
  basePath: "/docs",
  largestPages: 10,
  budgets: { routes: { raw: 65536, gzip: 16384 }, hydration: { share: 0.25 } },
} satisfies SsgOutputReportConfig;

type Frequency = NonNullable<NonNullable<SitemapConfig["defaults"]>["changeFrequency"]>;
type Route = Exclude<NonNullable<SitemapConfig["routes"]>[string], false>;
type RouteContext = Parameters<NonNullable<SitemapConfig["resolve"]>>[0];
type Budgets = NonNullable<SsgOutputReportConfig["budgets"]>;
type ByteBudget = NonNullable<Budgets["routes"]>;
const frequency: Frequency = "daily";
const route: Route = { priority: 0.7 };
const bytes: ByteBudget = { raw: 1024 };
declare const context: RouteContext;
context.path satisfies string;
context.filePath satisfies string;
context.status satisfies string;
void [sitemap, outputReport, frequency, route, bytes];
// @ts-expect-error only supported sitemap frequencies are accepted
const invalidFrequency: Frequency = "sometimes";
// @ts-expect-error byte budgets are numeric
const invalidBudget: ByteBudget = { gzip: "large" };
void [invalidFrequency, invalidBudget];
// @ts-expect-error supporting types are private in 0.5
import type { SitemapChangeFrequency as Removed0 } from "@askrjs/cli/ssg";
// @ts-expect-error supporting types are private in 0.5
import type { SitemapRouteConfig as Removed1 } from "@askrjs/cli/ssg";
// @ts-expect-error supporting types are private in 0.5
import type { SitemapRouteContext as Removed2 } from "@askrjs/cli/ssg";
// @ts-expect-error supporting types are private in 0.5
import type { SsgByteBudget as Removed3 } from "@askrjs/cli/ssg";
// @ts-expect-error supporting types are private in 0.5
import type { SsgOutputAsset as Removed4 } from "@askrjs/cli/ssg";
// @ts-expect-error supporting types are private in 0.5
import type { SsgOutputBudgets as Removed5 } from "@askrjs/cli/ssg";
// @ts-expect-error supporting types are private in 0.5
import type { SsgOutputReport as Removed6 } from "@askrjs/cli/ssg";
// @ts-expect-error supporting types are private in 0.5
import type { SsgOutputRoute as Removed7 } from "@askrjs/cli/ssg";
// @ts-expect-error supporting types are private in 0.5
import type { SsgOutputSize as Removed8 } from "@askrjs/cli/ssg";
type RemovedSurface = [
  Removed0,
  Removed1,
  Removed2,
  Removed3,
  Removed4,
  Removed5,
  Removed6,
  Removed7,
  Removed8,
];
declare const removedSurface: RemovedSurface;
void removedSurface;
