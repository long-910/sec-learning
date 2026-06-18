#!/bin/bash
# Run from repo root, or from scripts/ — either works.
cd "$(git rev-parse --show-toplevel)"

HASH=$(git rev-parse --short HEAD)
DATE=$(date +%Y-%m-%d)

cat > version.js << EOF
const APP_VERSION = { hash: "${HASH}", date: "${DATE}", label: "${HASH} · ${DATE}" };
(function () {
  function inject() {
    document.querySelectorAll('[data-version]').forEach(function (el) {
      el.textContent = APP_VERSION.label;
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
EOF

echo "version.js updated: ${HASH} · ${DATE}"
