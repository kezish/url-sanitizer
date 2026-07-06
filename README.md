# url-sanitizer

Hard gate that blocks token-wasteful web URL reads. Pairs with
`APPEND_SYSTEM.md` (soft nudge) — if the agent ignores the soft rule and
tries to fetch a GitHub HTML page / DeepWiki / npm page, this hook blocks
the `read` call and returns the correct raw/API URL in the error message.

The agent sees the block reason (with the correct URL), then retries with
the efficient endpoint. Net effect: zero wasted HTML in context.

## What it blocks

| URL pattern | Action | Suggestion returned |
|---|---|---|
| `github.com/:owner/:repo/tree/:branch/:path` | Block | `api.github.com/repos/:owner/:repo/contents/:path?ref=:branch` |
| `github.com/:owner/:repo/tree/:branch` | Block | `api.github.com/repos/:owner/:repo/contents?ref=:branch` |
| `github.com/:owner/:repo/blob/:branch/:path` | Block | `raw.githubusercontent.com/:owner/:repo/:branch/:path` |
| `github.com/:owner/:repo` | Block | `api.github.com/repos/:owner/:repo/contents` + raw README hint |
| `deepwiki.com/...` | Block | "find source on GitHub, fetch raw" |
| `npmjs.com/package/:name` | Block | `registry.npmjs.org/:name` |

Branch names with slashes (e.g. `feature/auth-fix`) are handled correctly —
the first path segment after `tree/` or `blob/` is treated as the branch,
the rest as the path.

## What it does NOT block

These pass through unchanged:

- `raw.githubusercontent.com/...` — already efficient
- `api.github.com/repos/...` — already efficient
- `registry.npmjs.org/...` — already efficient
- `github.com/:owner/:repo/wiki/...` — wiki pages, not tree/blob
- `github.com/:owner/:repo/pulls/...` — PR pages
- `github.com/:owner/:repo/issues/...` — issue pages
- Any other URL not matching the block patterns above
- Local file paths

## Files

```
url-sanitizer/
├── package.json
├── index.ts        # the hook
├── README.md       # this file
└── install.sh      # one-shot installer
```

## Install

```bash
bash install.sh
```

Or copy `package.json` + `index.ts` to `~/.omp/agent/extensions/url-sanitizer/`
and register in omp config:

```yaml
extensions:
  - ~/.omp/agent/extensions/url-sanitizer
```

## How it works

The hook registers a `tool_call` handler that intercepts every `read` tool
call. If the `path` argument is an `http(s)` URL matching a wasteful
pattern, it returns `{ block: true, reason: "<correct URL>" }`. The block
reason contains the efficient alternative URL, so the agent retries
immediately with the right endpoint.

No mutation of tool input — the hook can only block, not rewrite. The
agent does the retry itself after seeing the suggested URL in the error.

## Design decisions

- **Block, not rewrite**: omp's `tool_call` hook API can block or allow,
  but cannot mutate input parameters. Blocking with a suggested URL in the
  error message is the cleanest approach — the agent sees the correct URL
  and retries in one step.
- **GitHub repo root blocked**: `github.com/owner/repo` is an HTML page
  with a README render. The hook suggests the API contents endpoint and
  the raw README URL.
- **npm gets concrete URL**: not just "find the repo" — the hook returns
  `registry.npmjs.org/<pkg>` which gives compact JSON metadata including
  the repository URL, versions, and dependencies.
- **Branch slashes handled**: `github.com/owner/repo/tree/feature/auth-fix/src`
  is parsed as branch=`feature`, path=`auth-fix/src`. The block reason
  includes a note to pass the full branch as `ref` if it contains slashes.

## Disable

```bash
omp --no-extensions    # one session
```

Or remove from omp config:
```bash
omp config set extensions '[]'
```
