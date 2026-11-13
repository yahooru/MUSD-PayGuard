import next from "eslint-config-next";

const config = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**", "contracts/**", "next-env.d.ts"],
  },
  {
    rules: {
      "@next/next/no-img-element": "off",
      // Intentional: hydrating form state from fetched data and one-time client feature detection.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
