// URL sanitizer hook for oh-my-pi.
// Intercepts `read` tool calls with wasteful web URLs and BLOCKS them,
// returning the correct raw/API URL in the error message so the agent
// retries with the efficient endpoint.
//
// Pairs with APPEND_SYSTEM.md (soft nudge) — this is the hard gate.

interface BlockResult {
  block: true;
  reason: string;
}

// --- Type guards ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringProp(value: unknown, key: string): string | undefined {
  if (isRecord(value) && key in value) {
    const prop = value[key];
    return typeof prop === "string" ? prop : undefined;
  }
  return undefined;
}

interface PiWithOn {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
}

function piHasOn(pi: unknown): pi is PiWithOn {
  return isRecord(pi) && "on" in pi && typeof pi.on === "function";
}

// --- URL classification ---

interface RewriteResult {
  readonly blocked: boolean;
  readonly reason: string;
}

// File extensions that raw.githubusercontent.com serves correctly and that
// the read tool can handle as binary (images) or text. If a blob URL points
// to something outside this set, we still block but note it might need
// special handling.
const RAW_SAFE_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm",
  ".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift", ".scala", ".lua",
  ".sh", ".bash", ".zsh", ".fish", ".ps1",
  ".css", ".scss", ".less", ".sass",
  ".sql", ".graphql", ".proto",
  ".dockerfile", ".env", ".gitignore", ".gitattributes", ".editorconfig",
  ".lock", ".log",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".pdf", ".csv", ".tsv",
  ".ini", ".cfg", ".conf",
]);

function hasRawSafeExtension(path: string): boolean {
  const lower = path.toLowerCase();
  // Check exact extension, also handle dotfiles like .gitignore
  for (const ext of RAW_SAFE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  // Dotfiles without extension: Dockerfile, Makefile, etc.
  if (/\b(Dockerfile|Makefile|Rakefile|Gemfile|LICENSE|CHANGELOG|README)$/i.test(lower)) {
    return true;
  }
  return false;
}

function sanitizeUrl(url: string): RewriteResult {
  // --- GitHub ---
  // Parse owner/repo and the rest after the host.
  // GitHub URLs: github.com/:owner/:repo/:type/:branch/:path...
  // Branch names can contain slashes (e.g. feature/auth-fix), so we
  // cannot use a simple [^/]+ for branch. Instead, we split on /tree/ or
  // /blob/ and treat everything after as branch/path (first segment up to
  // the next / is the branch — but branch may have slashes too).
  //
  // Strategy: we know the API needs owner+repo+path+ref separately.
  // For tree: call contents API. For blob: raw URL.
  // Since we can't reliably split branch from path when branch has slashes,
  // we use the GitHub API for both (it accepts ref+path, and for blob we
  // can also use raw with the full path after tree/blob).
  //
  // Practical approach: match owner/repo, then the segment after tree/blob
  // is "branch/path" — we pass branch as ref and path as the rest. If the
  // branch has slashes, the API still works as long as we pass the full
  // branch as ref and the correct sub-path.
  //
  // But we CAN'T distinguish "feature/auth-fix" (branch) from "feature" (branch)
  // + "auth-fix" (path) by regex alone. So we take a different approach:
  // block and give the agent the API/raw base URL with instructions, letting
  // the agent construct the correct URL (it knows the branch from context).

  const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(tree|blob)\/(.+)$/);
  if (ghMatch) {
    const [, owner, repo, type, branchAndPath] = ghMatch;
    // Split branch and path: first segment is branch (may contain slashes,
    // but we can't know without API). For common cases (no slash in branch),
    // split on first /.
    const slashIdx = branchAndPath.indexOf("/");
    const branch = slashIdx === -1 ? branchAndPath : branchAndPath.slice(0, slashIdx);
    const path = slashIdx === -1 ? "" : branchAndPath.slice(slashIdx + 1);

    if (type === "tree") {
      const api = path
        ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`
        : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`;
      return {
        blocked: true,
        reason: `GitHub HTML page wastes ~30KB on SVG/CSS. Use the API instead:\n${api}\n(If the branch name contains slashes, pass the full branch as the ref parameter.)`,
      };
    }

    // blob → raw
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branchAndPath}`;
    if (hasRawSafeExtension(path)) {
      return {
        blocked: true,
        reason: `GitHub HTML page wastes ~30KB on SVG/CSS. Use raw instead:\n${raw}`,
      };
    }
    // Unknown extension — still block but warn about possible binary.
    return {
      blocked: true,
      reason: `GitHub HTML page wastes ~30KB on SVG/CSS. Use raw instead (may be binary):\n${raw}`,
    };
  }

  // --- GitHub repo root (no tree/blob) ---
  // github.com/owner/repo → just the repo page. Block and suggest
  // fetching README raw or using the API to list root contents.
  const ghRootMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (ghRootMatch) {
    const [, owner, repo] = ghRootMatch;
    return {
      blocked: true,
      reason: `GitHub repo page is HTML-heavy. To list files: https://api.github.com/repos/${owner}/${repo}/contents\nTo read README: https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md (or main/master)`,
    };
  }

  // --- DeepWiki ---
  if (/^https?:\/\/deepwiki\.com\//.test(url)) {
    return {
      blocked: true,
      reason: `DeepWiki wraps ~5KB of content in ~50KB of SVG/CSS. Find the source file on GitHub and fetch it raw (raw.githubusercontent.com/owner/repo/branch/path).`,
    };
  }

  // --- npm ---
  const npmMatch = url.match(/^https?:\/\/(?:www\.)?npmjs\.com\/package\/(@[^/]+\/[^/]+|[^/]+)/);
  if (npmMatch) {
    const pkg = npmMatch[1];
    // npm registry API returns compact JSON with repo URL, versions, etc.
    const registry = `https://registry.npmjs.org/${pkg}`;
    return {
      blocked: true,
      reason: `npm page is HTML-heavy. Use the registry API for metadata (versions, deps, repo URL):\n${registry}\nThen fetch the README from the repo's raw URL.`,
    };
  }

  return { blocked: false, reason: "" };
}

// --- Extension factory ---

export default function (pi: unknown): void {
  if (!piHasOn(pi)) return;

  pi.on(
    "tool_call",
    async (event: unknown, _ctx: unknown): Promise<void | BlockResult> => {
      const toolName = getStringProp(event, "toolName");
      if (toolName !== "read") return;

      const input = isRecord(event) && "input" in event ? event.input : undefined;
      const path = getStringProp(input, "path");
      if (path === undefined) return;

      if (!/^https?:\/\//.test(path)) return;

      const result = sanitizeUrl(path);
      if (!result.blocked) return;

      return {
        block: true,
        reason: result.reason,
      };
    },
  );
}
