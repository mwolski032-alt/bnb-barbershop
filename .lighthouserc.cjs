module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist/client",
      url: ["http://localhost/"],
      numberOfRuns: process.env.CI ? 3 : 1,
      settings: {
        chromeFlags: "--headless --no-sandbox --disable-dev-shm-usage",
        preset: "desktop",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.6 }],
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.85 }],
        "first-contentful-paint": ["error", { maxNumericValue: 3500 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 4000 }],
        "total-blocking-time": ["error", { maxNumericValue: 600 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
