#!/usr/bin/env bash
# url-sanitizer installer
set -euo pipefail
AGENT_DIR="${1:-${HOME}/.omp/agent}"
EXT_DIR="${AGENT_DIR}/extensions"
TARGET="${EXT_DIR}/url-sanitizer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "${EXT_DIR}"

if [[ "${SCRIPT_DIR}" != "${TARGET}" ]]; then
  rm -rf "${TARGET}"
  cp -r "${SCRIPT_DIR}" "${TARGET}"
fi

if command -v omp &>/dev/null; then
  CURRENT="$(omp config get extensions --json 2>/dev/null || echo '{"value":[]}')"
  TARGET_REAL="$(realpath "${TARGET}" 2>/dev/null || echo "${TARGET}")"
  NEW="$(node -e "
    const target = process.argv[1];
    const targetReal = process.argv[2];
    const current = JSON.parse(process.argv[3] || '{\"value\":[]}');
    const arr = Array.isArray(current.value) ? current.value : [];
    const fs = require('fs');
    const path = require('path');
    const filtered = arr.filter((entry) => {
      try {
        const resolved = path.resolve(entry.replace(/^~(?=$|\/|\\)/, process.env.HOME));
        return fs.realpathSync(resolved) !== targetReal;
      } catch { return true; }
    });
    filtered.push(target);
    process.stdout.write(JSON.stringify(filtered));
  " "${TARGET}" "${TARGET_REAL}" "${CURRENT}" 2>/dev/null || echo "[]")"
  [[ -n "${NEW}" && "${NEW}" != "[]" ]] && omp config set extensions "${NEW}" 2>/dev/null || true
fi

echo "Done. url-sanitizer installed at ${TARGET}"
echo "Restart omp session for changes to take effect."
