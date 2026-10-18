import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { PUBLIC_URL: "https://coach.test", OWNER_PASSWORD: "correct horse battery staple" }
      }
    })
  ]
});
