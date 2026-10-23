import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          PUBLIC_URL: "https://coach.test",
          OWNER_PASSWORD: "correct horse battery staple",
          GARMIN_API_KEY: "GCDC_test-key",
          GARMIN_API: "personal"
        }
      }
    })
  ]
});
