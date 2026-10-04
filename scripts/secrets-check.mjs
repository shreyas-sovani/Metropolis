import { execFileSync } from "node:child_process";

/**
 * Scan the staged diff for private keys and known token prefixes.
 * Bytes32 literals inside vendored ABI JSON match `0x` + 64 hex, so that
 * path is exempt from the key pattern only. Token prefixes still apply.
 */

const KEY_RE = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const TOKEN_PATTERNS = [
  { name: "github-pat", re: /ghp_[A-Za-z0-9]{20,}/ },
  { name: "github-fine-grained", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "stripe-secret", re: /sk_(live|test)_[A-Za-z0-9]{10,}/ },
  { name: "openai-or-anthropic", re: /sk-(ant|proj)-[A-Za-z0-9_-]{10,}/ },
  { name: "npm-token", re: /npm_[A-Za-z0-9]{20,}/ },
  { name: "gitlab-pat", re: /glpat-[A-Za-z0-9_-]{20,}/ },
];

const ABI_JSON = /^packages\/core\/src\/abi\/.+\.json$/;

function stagedDiff() {
  try {
    return execFileSync("git", ["diff", "--cached", "-U0", "--no-color"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    console.error("secrets:check: git diff --cached failed");
    process.exit(1);
  }
}

function findingsIn(file, line) {
  const found = [];
  if (!ABI_JSON.test(file)) {
    KEY_RE.lastIndex = 0;
    if (KEY_RE.test(line)) found.push("private-key");
  }
  for (const pattern of TOKEN_PATTERNS) {
    if (pattern.re.test(line)) found.push(pattern.name);
  }
  return found;
}

const diff = stagedDiff();
const hits = new Map();
let file = "";

for (const raw of diff.split("\n")) {
  if (raw.startsWith("+++ b/")) {
    file = raw.slice("+++ b/".length);
    continue;
  }
  if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
  const line = raw.slice(1);
  for (const name of findingsIn(file, line)) {
    const key = `${name} in ${file || "(unknown)"}`;
    hits.set(key, (hits.get(key) ?? 0) + 1);
  }
}

if (hits.size > 0) {
  console.error("secrets:check: staged diff matched secret patterns");
  for (const [label, count] of hits) {
    console.error(`  ${label} (${count})`);
  }
  process.exit(1);
}

console.log("secrets:check: ok");
