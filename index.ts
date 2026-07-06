// URL sanitizer hook for oh-my-pi.
// Intercepts `read` tool calls with wasteful web URLs and BLOCKS them,
// returning the correct raw/API URL in the error message so the agent
// retries with the efficient endpoint.
//
// This is a hard gate: APPEND_SYSTEM.md is the soft nudge, this is the
// enforcement. If the agent ignores the soft rule, this hook catches it.
//
// Blocked patterns → suggested replacement in the block reason:
//   github.com/.../tree/...  → api.github.com/repos/.../contents/...
//   github.com/.../blob/...  → raw.githubusercontent.com/...
//   deepwiki.com/...         → (block, suggest find source on GitHub)
//   npmjs.com/package/...    → (block, suggest find repo README raw)

interface BlockResult {
  block: true;
  reason: string;
}

// --- Type guards (no casts) ---

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

// --- URL rewriting logic ---

interface RewriteResult {
  readonly blocked: boolean;
  readonly reason: string;
}

function sanitizeUrl(url: string): RewriteResult {
  // GitHub tree/branch/directory pages → API contents endpoint
  // Match: github.com/owner/repo/tree/branch/path...
  let m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(\/.*)?$/);
  if (m) {
    const [, owner, repo, branch, pathPart] = m;
    const path = pathPart ? pathPart.replace(/^\//, "") : "";
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    return {
      blocked: true,
      reason: `GitHub HTML page wastes ~30KB on SVG/CSS. Use the API instead:\n${api}`,
    };
  }

  // GitHub blob (file view) → raw.githubusercontent.com
  // Match: github.com/owner/repo/blob/branch/path...
  m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)(\/.*)?$/);
  if (m) {
    const [, owner, repo, branch, pathPart] = m;
    const path = pathPart ? pathPart.replace(/^\//, "") : "";
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    return {
      blocked: true,
      reason: `GitHub HTML page wastes ~30KB on SVG/CSS. Use raw instead:\n${raw}`,
    };
  }

  // DeepWiki → block, suggest GitHub source
  if (/^https?:\/\/deepwiki\.com\//.test(url)) {
    return {
      blocked: true,
      reason: `DeepWiki wraps ~5KB of content in ~50KB of SVG/CSS. Find the source file on GitHub and fetch it raw (raw.githubusercontent.com/owner/repo/branch/path).`,
    };
  }

  // npm package page → block, suggest GitHub README
  m = url.match(/^https?:\/\/(?:www\.)?npmjs\.com\/package\/(@[^/]+\/[^/]+|[^/]+)/);
  if (m) {
    return {
      blocked: true,
      reason: `npm page is HTML-heavy. Find the repo URL and fetch its README raw (raw.githubusercontent.com/owner/repo/main/readme.md).`,
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

      // Only intercept http(s) URLs.
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
