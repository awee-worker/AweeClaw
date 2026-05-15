#!/bin/bash
cd "$(dirname "$0")/src"

echo "=== Fixing import paths with perl ==="

# @shared/types -> @protocols
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|from '"'"'@shared/types'"'"'|from '"'"'@protocols'"'"'|g;
  s|from '"'"'@/shared/types'"'"'|from '"'"'@protocols'"'"'|g;
  s|'"'"'@/shared/types/|'"'"'@protocols/|g;
  s|'"'"'@shared/types/|'"'"'@protocols/|g;
'

# @shared/config -> @configuration
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|'"'"'@/shared/config/|'"'"'@configuration/|g;
  s|'"'"'@shared/config/|'"'"'@configuration/|g;
'

# @shared/utils -> @toolkit
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|from '"'"'@shared/utils'"'"'|from '"'"'@toolkit'"'"'|g;
  s|from '"'"'@/shared/utils'"'"'|from '"'"'@toolkit'"'"'|g;
  s|'"'"'@/shared/utils/|'"'"'@toolkit/|g;
  s|'"'"'@shared/utils/|'"'"'@toolkit/|g;
'

# @shared/errors -> @shared/exceptions
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|from '"'"'@/shared/errors'"'"'|from '"'"'@shared/exceptions'"'"'|g;
  s|from '"'"'@shared/errors'"'"'|from '"'"'@shared/exceptions'"'"'|g;
  s|'"'"'@/shared/errors|'"'"'@shared/exceptions|g;
  s|'"'"'@shared/errors|'"'"'@shared/exceptions|g;
'

# @intelligence sub-paths
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|@intelligence/store/|@intelligence/state/|g;
  s|@intelligence/core\b|@intelligence/engine|g;
  s|@intelligence/tools/|@intelligence/toolkit/|g;
  s|@intelligence/services/|@intelligence/runtime/|g;
  s|@intelligence/prompts/|@intelligence/prompt-engine/|g;
  s|@intelligence/plan/|@intelligence/planner/|g;
'

# @renderer/agent -> @intelligence (remaining)
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|@renderer/agent/tools/providers|@intelligence/toolkit/providers|g;
  s|@renderer/agent/types|@intelligence/types|g;
  s|@renderer/agent/store/AgentStore|@intelligence/state/AgentStore|g;
  s|@renderer/agent/core|@intelligence/engine|g;
  s|@renderer/agent/|@intelligence/|g;
'

# @renderer/store -> @store (remaining)
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e "
  s|from '"'"'@renderer/store'"'"'|from '"'"'@store'"'"'|g;
  s|@renderer/store/|@store/|g;
"

# @renderer/hooks -> @hooks (remaining)
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|from '"'"'@renderer/hooks'"'"'|from '"'"'@hooks'"'"'|g;
  s|@renderer/hooks/|@hooks/|g;
'

# @renderer/services -> @services (remaining)
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|@renderer/services/|@services/|g;
'

# @renderer/utils -> @utils (remaining)
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|@renderer/utils/|@utils/|g;
'

# @renderer/intelligence -> @intelligence (remaining)
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|@renderer/intelligence/|@intelligence/|g;
'

# @renderer/components/agent -> @components/intelligence
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|@renderer/components/agent/|@components/intelligence/|g;
  s|@renderer/components/chat/|@components/conversation/|g;
  s|@renderer/components/common/|@components/foundation/|g;
  s|@renderer/components/editor/|@components/code-editor/|g;
  s|@renderer/components/sidebar/|@components/explorer/|g;
'

# @main/security -> @guard
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|@main/security/|@guard/|g;
  s|@main/services/|@modules/|g;
'

# Relative path fixes
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs perl -pi -e '
  s|\.\./store/AgentStore|@intelligence/state/AgentStore|g;
  s|\.\./common/ToastProvider|@components/foundation/ToastProvider|g;
  s|\.\./common/ConfirmDialog|@components/foundation/ConfirmDialog|g;
  s|\.\./common/InlineToast|@components/foundation/InlineToast|g;
  s|\.\./common/InputPopup|@components/foundation/InputPopup|g;
  s|\.\./common/toastLayerStore|@components/foundation/toastLayerStore|g;
  s|\.\./\.\./common/ToastProvider|@components/foundation/ToastProvider|g;
  s|\.\./\.\./common/ConfirmDialog|@components/foundation/ConfirmDialog|g;
'

echo "=== All import paths fixed ==="
