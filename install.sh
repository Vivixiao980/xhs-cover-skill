#!/bin/bash
# 小红书封面生成器 - Claude Code Skill 安装脚本

set -e

SKILL_DIR="$HOME/.claude/skills/xhs-cover"
REPO_URL="https://github.com/Vivixiao980/xhs-cover-skill"

echo "🎨 安装小红书封面生成器 Skill..."

# 检查是否已安装 Claude Code
if ! command -v claude &> /dev/null; then
  echo "❌ 未检测到 Claude Code，请先安装：https://claude.ai/code"
  exit 1
fi

# 检查 Node.js 版本（需要 >= 18）
if ! command -v node &> /dev/null; then
  echo "❌ 未检测到 Node.js，请安装 Node.js 18 或更高版本："
  echo "   https://nodejs.org/"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node.js 版本过低（当前 $(node -v)，需要 >= v18）"
  echo "   请升级 Node.js：https://nodejs.org/"
  exit 1
fi

echo "✓ Node.js $(node -v)"

# 检查是否已存在
if [ -d "$SKILL_DIR" ]; then
  echo "⚠️  Skill 已存在于 $SKILL_DIR"
  read -r -p "   是否更新？现有文件将被覆盖 [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "已取消。"
    exit 0
  fi
  echo "🔄 更新中..."
  git -C "$SKILL_DIR" pull 2>/dev/null || {
    echo "   Git pull 失败，重新克隆..."
    read -r -p "   需要删除 $SKILL_DIR 并重新安装，确认继续？[y/N] " confirm2
    if [[ ! "$confirm2" =~ ^[Yy]$ ]]; then
      echo "已取消。"
      exit 0
    fi
    rm -rf "$SKILL_DIR"
    git clone "$REPO_URL" "$SKILL_DIR"
  }
else
  mkdir -p "$(dirname "$SKILL_DIR")"
  git clone "$REPO_URL" "$SKILL_DIR"
fi

# 安装依赖
echo "📦 安装依赖（sharp）..."
cd "$SKILL_DIR" && npm install --production --silent
echo "✓ 依赖安装完成"

echo ""
echo "✅ 安装完成！"
echo ""
echo "在 Claude Code 中输入「生成封面」或「小红书封面」即可开始使用。"
echo "首次使用需要配置 API Key（约 2 分钟）。"
echo ""
echo "📖 详细文档：$REPO_URL"
echo "🌐 风格预览：https://xhscover.vivi.wiki"
