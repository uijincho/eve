import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Overview is the organizer home. The inbox used to live at "/", so bare
  // root links (bookmarks, old notifications) land on the new home.
  redirects() {
    return [{ source: "/", destination: "/overview", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// withWorkflow enables the "use workflow" / "use step" directives and
// generates the runtime routes under app/.well-known/workflow/ at build time.
export default withWorkflow(nextConfig);
