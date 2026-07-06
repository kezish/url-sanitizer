# url-sanitizer

Hard gate that blocks token-wasteful web URL reads. Pairs with
`APPEND_SYSTEM.md` (soft nudge) — if the agent ignores the soft rule and
tries to fetch a GitHub HTML page / DeepWiki / npm page, this hook blocks
the `read` call and returns the correct raw/API URL in the error message.

## What it blocks

| URL pattern | Action | Suggestion returned |
|---|---|---|
| `github.com/.../tree/...` | Block | `api.github.com/repos/.../contents/...` |
| `github.com/.../blob/...` | Block | `raw.githubusercontent.com/...` |
| `deepwiki.com/...` | Block | "find source on GitHub, fetch raw" |
| `npmjs.com/package/...` | Block | "find repo, fetch README raw" |

The agent sees the block reason (with the correct URL), then retries with
the efficient endpoint. Net effect: zero wasted HTML in context.

## Install

```bash
bash install.sh
```

Or copy `package.json` + `index.ts` to `~/.omp/agent/extensions/url-sanitizer/`.
