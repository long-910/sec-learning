#!/bin/bash
# Install git hooks for this repo. Run once after cloning.
cd "$(git rev-parse --show-toplevel)"

cat > .git/hooks/pre-commit << 'HOOK'
#!/bin/bash
if [ -f scripts/update-version.sh ]; then
  bash scripts/update-version.sh
  git add version.js
fi
HOOK

chmod +x .git/hooks/pre-commit
echo "pre-commit hook installed."
