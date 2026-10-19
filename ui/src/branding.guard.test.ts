import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Branding guard: the product is ChampVoice, so no user-visible "Dograh"
 * string may survive in ui/src.
 *
 * Every leftover occurrence must be one of the documented protocol holes
 * below. Anything else fails the build. The list is deliberately tiny:
 * widening it hides a real branding leak.
 */

const SRC = join(process.cwd(), "src");
const SELF = relative(SRC, fileURLToPath(import.meta.url));

// Generated from the OpenAPI schema: field names, provider enum values and
// type names are the wire protocol. Regenerate with `pnpm generate-client`
// if the API ever renames them.
const GENERATED_DIR = "client/";

// Tokens that are protocol, not copy. Applied in order; whatever still
// contains "dograh" afterwards is a user-visible string and fails.
const ALLOWED = [
  // Outbound URLs and hosts (docs.dograh.com, app.dograh.com, GHCR images,
  // the upstream GitHub repo, the Axiom log dataset).
  { re: /https?:\/\/\S+/gi, why: "URL" },
  // Provider / model-mode enum values, e.g. provider: 'dograh', mode: "dograh".
  { re: /["'`]dograh["'`]/g, why: "enum value" },
  // Identifiers with dograh glued to other word characters:
  // configuredDograh, DograhFormState, setDograh, used_dograh_tokens.
  { re: /\b\w*dograh\w+\b/gi, why: "identifier" },
  { re: /\b\w+dograh\b/gi, why: "identifier" },
  // Separator-joined ids and paths: dograh_speed keys like dograh-auth,
  // dograh-widget.js, dograh-inline-container, data-dograh-context,
  // app.dograh.com, dograh-hq/dograh-ui, \/dograh\/ui\//.
  { re: /dograh[-_./\\][a-z0-9_.\\-]*/g, why: "separated id" },
  // Object / storage keys: dograh: { ..., `dograh:hireNudge:`
  { re: /\bdograh\s*:/g, why: "object key" },
  // Member access on code identifiers: configuration.dograh, [dograh, {dograh.
  // Copy never spells the brand in lowercase, and JSX text after `>` is not
  // preceded by these characters, so visible lowercase text still fails.
  { re: /[.({[]\s*dograh\b/g, why: "member access" },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Returns lines of `text` that still mention dograh after the allowlist. */
export function violations(text: string, file = "sample"): string[] {
  const bad: string[] = [];
  let inBlockComment = false;
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    const isLineComment =
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("<!--") ||
      trimmed.startsWith("#");
    if (trimmed.includes("/*") && !trimmed.includes("*/")) inBlockComment = true;
    const closesBlock = inBlockComment && trimmed.includes("*/");
    if (closesBlock) inBlockComment = false;
    // Comments are not rendered, so they may still name the upstream project.
    if (isLineComment || inBlockComment || closesBlock || trimmed === "") return;

    let rest = line;
    for (const { re } of ALLOWED) rest = rest.replace(re, "");
    if (/dograh/i.test(rest)) bad.push(`${file}:${index + 1}: ${trimmed.slice(0, 160)}`);
  });
  return bad;
}

describe("ChampVoice branding guard", () => {
  it("flags a plain user-visible Dograh string", () => {
    expect(violations('const copy = "Talk to Dograh today";')).toHaveLength(1);
    expect(violations("<p>Powered by dograh</p>")).toHaveLength(1);
    expect(violations('const copy = "Talk to ChampVoice today";')).toHaveLength(0);
    // Protocol values stay allowed.
    expect(violations('const mode: ModelMode = "dograh";')).toHaveLength(0);
  });

  it("keeps every dograh occurrence in ui/src on the protocol allowlist", () => {
    const found: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel === SELF || rel.startsWith(GENERATED_DIR)) continue;
      found.push(...violations(readFileSync(file, "utf8"), rel));
    }
    expect(found, `user-visible Dograh strings found:\n${found.join("\n")}`).toEqual([]);
  });
});
