#!/bin/bash
# 小红书封面生成器 - Claude Code Skill 安装脚本

set -e

REPO_URL="https://github.com/Vivixiao980/xhs-cover-skill"

# 自动检测安装平台
if [ -d "$HOME/.claude/skills" ]; then
  SKILL_DIR="$HOME/.claude/skills/xhs-cover"
  echo "📍 检测到 Claude Code，安装到 $SKILL_DIR"
elif [ -d "$HOME/.openclaw/skills" ]; then
  SKILL_DIR="$HOME/.openclaw/skills/xhs-cover"
  echo "📍 检测到 OpenClaw，安装到 $SKILL_DIR"
else
  echo "未检测到 Claude Code 或 OpenClaw 的 skills 目录。请选择安装位置："
  echo "  1) Claude Code  ($HOME/.claude/skills/xhs-cover)"
  echo "  2) OpenClaw     ($HOME/.openclaw/skills/xhs-cover)"
  echo "  3) 自定义路径"
  read -r -p "请输入选项 [1/2/3]: " choice
  case "$choice" in
    1) SKILL_DIR="$HOME/.claude/skills/xhs-cover" ;;
    2) SKILL_DIR="$HOME/.openclaw/skills/xhs-cover" ;;
    3) read -r -p "请输入完整安装路径: " SKILL_DIR ;;
    *) echo "无效选项"; exit 1 ;;
  esac
fi

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

# 安装依赖（兼容 npm 6 的 --production 和 npm 7+ 的 --omit=dev）
echo "📦 安装依赖（sharp）..."
cd "$SKILL_DIR"
if npm install --omit=dev --silent 2>/dev/null || npm install --production --silent; then
  :
else
  echo "❌ 依赖安装失败。如果是 sharp 编译错误，尝试："
  echo "   cd $SKILL_DIR && npm install --omit=dev --ignore-scripts && npm rebuild sharp"
  exit 1
fi
echo "✓ 依赖安装完成"

echo ""
echo "✅ 安装完成！"
echo ""
echo "在 Claude Code 中输入「生成封面」或「小红书封面」即可开始使用。"
echo "首次使用需要配置 API Key（约 2 分钟）。"
echo ""
echo "📖 详细文档：$REPO_URL"
echo "🌐 风格预览：https://xhscover.vivi.wiki"
