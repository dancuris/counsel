/**
 * Freezes the git history into src/generated/changelog.json so the app can show
 * what shipped and why.
 *
 * Generated and committed rather than read at request time, because Vercel does
 * not build from a full clone - there is no history in the build container to
 * read, and reaching for the GitHub API would mean giving the app a token it
 * otherwise has no use for. The tradeoff is that the file is only as current as
 * the last run, which the Releases page says out loud rather than hiding.
 *
 * The commit bodies here carry the reasoning, which is the entire point: this
 * surfaces the "why" that is otherwise only visible in a terminal.
 *
 * Run: npm run changelog   (then commit the result)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const OUT = "src/generated/changelog.json";
const NAMES_FILE = ".private-names";

/**
 * Commit bodies carry the reasoning, and the reasoning names real recruiters
 * and employers. That text is frozen into this file and rendered on /releases,
 * so it is the one route into the published repository that no file-scanning
 * check can watch: the source is git, not a file in the tree.
 *
 * Redacted here rather than by hand, because a hand edit is undone by the very
 * next run - which is exactly what happened once.
 */
function redactor(): (text: string) => string {
  let patterns: string[] = [];
  try {
    patterns = readFileSync(NAMES_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    // No list means nothing to redact, which is right for a clone.
  }
  if (patterns.length === 0) return (t) => t;

  const rx = new RegExp(
    "\\b(" + patterns.map((e) => e.split("=")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
    "gi"
  );
  const GENERIC = new Map(patterns.map((e) => [e.split("=")[0].toLowerCase(), e.split("=").slice(1).join("=")]));
  return (text) => text.replace(rx, (m) => GENERIC.get(m.toLowerCase()) || "[redacted]");
}
const MAX = 200;

// Record and field separators that cannot occur in a commit message.
type Entry = {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
};

const RECORD = "\x1e";
const FIELD = "\x1f";

// Trailers are plumbing, not reasoning. They are stripped so the page shows the
// explanation and nothing else.
const TRAILER = /^(Co-Authored-By:|Claude-Session:|Signed-off-by:|🤖 Generated with)/i;

function cleanBody(body: string): string {
  return body
    .split("\n")
    .filter((line) => !TRAILER.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function main() {
  const redact = redactor();

  const raw = execFileSync(
    "git",
    ["log", `--max-count=${MAX}`, `--format=%H${FIELD}%an${FIELD}%aI${FIELD}%s${FIELD}%b${RECORD}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );

  const entries = raw
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, author, date, subject, ...bodyParts] = record.split(FIELD);
      return {
        sha,
        shortSha: sha.slice(0, 7),
        author,
        date,
        subject: redact(subject),
        body: redact(cleanBody(bodyParts.join(FIELD) ?? "")),
      };
    })
    .filter((e) => e.sha && e.subject);

  // Merged with whatever is already in the file, never replacing it.
  //
  // The repository this ships from was re-created with a clean history, so
  // `git log` no longer reaches back past the first public commit. Regenerating
  // from scratch would silently throw away every release before the move and
  // leave the Releases page claiming the project began that day. Existing
  // entries are kept, new commits are added in front of them, and a sha present
  // in both takes the version from git, which is the live one.
  let existing: Entry[] = [];
  try {
    const prior = JSON.parse(readFileSync(OUT, "utf8")) as { entries?: Entry[] };
    existing = Array.isArray(prior.entries) ? prior.entries : [];
  } catch {
    // No file yet, or unreadable. Starting from git alone is correct then.
  }

  const bySha = new Map<string, Entry>();
  for (const entry of existing) bySha.set(entry.sha, entry);
  for (const entry of entries) bySha.set(entry.sha, entry);

  const merged = [...bySha.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, MAX);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), entries: merged }, null, 2) + "\n");

  const added = merged.length - existing.length;
  console.log(`${entries.length} from git, ${existing.length} kept, ${merged.length} total -> ${OUT}`);
  if (added > 0) console.log(`newest: ${merged[0]?.shortSha} ${merged[0]?.subject}`);
}

main();
