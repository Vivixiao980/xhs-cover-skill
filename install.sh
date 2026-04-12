#!/bin/bash
# 小红书封面生成器 - Claude Code Skill 安装脚本

set -e

SKILL_DIR="$HOME/.claude/skills/xhs-cover"

echo "🎨 安装小红书封面生成器 Skill..."

# 检查是否已安装 Claude Code
if ! command -v claude &> /dev/null; then
  echo "❌ 未检测到 Claude Code，请先安装：https://claude.ai/code"
  exit 1
fi

# 检查是否已存在
if [ -d "$SKILL_DIR" ]; then
  echo "⚠️  Skill 已存在，正在更新..."
  git -C "$SKILL_DIR" pull 2>/dev/null || {
    echo "更新失败，尝试重新安装..."
    rm -rf "$SKILL_DIR"
    git clone https://github.com/Vivixiao980/xhs-cover-skill "$SKILL_DIR"
  }
else
  mkdir -p "$(dirname "$SKILL_DIR")"
  git clone https://github.com/Vivixiao980/xhs-cover-skill "$SKILL_DIR"
fi

echo ""
echo "✅ 安装完成！"
echo ""
echo "在 Claude Code 中输入「生成封面」或「小红书封面」即可开始使用。"
echo "首次使用需要配置 API Key（约 2 分钟）。"
echo ""
echo "📖 详细文档：https://github.com/Vivixiao980/xhs-cover-skill"
echo "🌐 风格预览：https://xhscover.vivi.wiki"
