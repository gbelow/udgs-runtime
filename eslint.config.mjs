import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },

  // ── Architectural boundaries ──────────────────────────────────────────────
  // The project's one non-negotiable rule is that the pure domain owns all game
  // rules and React only renders them. These two rules make that boundary
  // mechanical instead of a convention people have to remember.

  // 1. The domain must not depend on React or on the state layer. Data flows
  //    domain -> stores -> hooks -> UI; a domain module importing a store (even
  //    for a type) inverts that arrow and lets Zustand define the domain's shape.
  {
    files: ["app/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["**/stores/*", "**/stores/**", "**/actions", "**/actions/**", "react", "react-dom", "zustand", "zustand/**"],
            message:
              "The domain layer is pure and React-free. Data flows domain -> stores -> hooks -> UI, so the domain must define its own types and never import from app/stores, app/actions or React. If a store needs a shape, declare it in the domain and have the store import it; persistence calls the domain, never the other way round.",
          },
        ],
      }],
    },
  },

  // 2. Components must not reach into the rule-bearing halves of the domain, nor
  //    into the state layer. Lenses and commands ARE the game rules, and so is
  //    every constant in tables.ts; a component that imports one is one step
  //    away from reimplementing it inline (which is how the armor tier table,
  //    the STA regen formula and the weapon STR-mod duplicate all got into JSX).
  //    Stores are barred for the other half of the same flow: domain -> stores
  //    -> hooks -> UI only holds if the UI enters at the hook. Inert modules —
  //    types, lists, factories, utils, dice — stay allowed.
  {
    files: ["app/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: [
              "**/domain/*/lenses",
              "**/domain/*/lenses/**",
              "**/domain/*/commands",
              "**/domain/*/commands/**",
            ],
            allowTypeImports: true,
            message:
              "Components render domain projections; they do not import lenses or commands. Add a getter to a lens or a command in app/domain, expose it through a hook in app/hooks, and call the hook. (Type-only imports are fine: use `import type`.)",
          },
          {
            group: ["**/domain/tables"],
            allowTypeImports: true,
            message:
              "tables.ts holds rule data — costs, thresholds, modifiers. A component that indexes it is rendering a rule the domain should have projected: add a view getter beside the table and expose it through a hook. Inert name lists belong in app/domain/lists.ts, which components may import.",
          },
          {
            group: ["**/stores/*", "**/stores/**"],
            allowTypeImports: true,
            message:
              "Components do not talk to Zustand directly. Data flows domain -> stores -> hooks -> UI, so add an adapter in app/hooks (see useGameTab, useCharacterLibrary, useCombatState) and call that instead.",
          },
        ],
      }],
    },
  },

  // Bindings that exist on purpose without being read: the rest-sibling omit
  // idiom (`const { [key]: _removed, ...rest }`) and parameters held in place
  // while the formula that used them is staged out. A leading underscore marks
  // them as deliberate, so the rule keeps flagging the accidental ones.
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },

  // BreakMe is a stress-test harness, not UI: it mounts probes against the lens
  // registry and drives the store directly in order to measure the cost of a
  // mutation. Reaching into the domain is the point of the file.
  {
    files: ["app/components/BreakMe.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default eslintConfig;
