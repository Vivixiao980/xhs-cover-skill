---
name: xhs-cover
description: 生成小红书封面图片。支持18种预设风格，使用 Gemini API 直接在命令行生成封面。触发词：生成封面、xhs封面、小红书封面、制作封面
---

# 小红书封面生成器

在命令行直接生成小红书封面，无需打开网站。

- **官网**：https://xhscover.vivi.wiki（可在线预览所有风格效果图）
- **作者**：Vivi
- **支持风格**：18种预设风格，覆盖职场、居家、综艺、文艺等场景
- **技术原理**：调用 Gemini 图片生成模型，将你的人像照片 + 文字要求合成为封面图

---

## 执行流程

### Step 1：检查配置（首次使用 Onboarding）

```bash
cat ~/.config/xhs-cover/config.json 2>/dev/null
```

**如果文件存在且有 `apiKey` 字段 → 跳到 Step 2。**

否则进入 Onboarding：

#### 1a. 介绍 Skill

向用户展示以下介绍（用 markdown 格式输出，清晰美观）：

```
🎨 欢迎使用小红书封面生成器！

这个工具让你直接在命令行生成小红书封面，无需打开网站。
你只需要：一张人物照片 + 标题文字 → 即可生成封面。

📖 官网：https://xhscover.vivi.wiki
   （可在线预览18种风格的效果示例，帮你选择合适的风格）

👩‍💻 作者：Vivi

首次使用需要配置一次 API Key，之后每次直接生成。
```

#### 1b. 选择 API 类型

用 AskUserQuestion 询问（**必须先问这个，再问 key**）：

**问题**："请选择 API 来源"

| 选项 | 说明 |
|------|------|
| Google AI Studio（官方，免费） | 使用谷歌官方 API，免费额度充足，需要科学上网，适合个人使用 |
| 第三方 API 代理 | 使用兼容 OpenAI 格式的第三方代理服务，无需科学上网，需提供 Base URL、API Key 和模型名称 |

#### 1c. 根据选择收集 API 信息

**如果选择 Google AI Studio**：

向用户说明如何获取 API Key：
```
📝 获取 Google AI Studio API Key 步骤：
1. 访问 https://aistudio.google.com/apikey
2. 登录 Google 账号
3. 点击「Create API key」
4. 复制生成的 Key（以 AIza 开头）

免费额度：每分钟最多15次请求，足够个人使用。
```

用 AskUserQuestion 询问：
- **API Key**（必填，以 AIza 开头）

然后自动设定：
- `baseUrl` = `https://generativelanguage.googleapis.com/v1beta/openai`
- `model` = `gemini-2.0-flash-exp-image-generation`

**如果选择第三方 API**：

用 AskUserQuestion 一次性询问以下三项：
- **API Base URL**（必填，例如 `https://api.your-provider.com`）
- **API Key**（必填，由服务商提供）
- **模型名称**（必填，可向服务商确认支持的模型，推荐填写 `gemini-3-pro-image-preview`）

#### 1d. 询问输出目录

用 AskUserQuestion 询问（可跳过用默认值）：
- **封面保存目录**（默认：`~/Desktop/XHS封面`）

#### 1e. 保存配置

先运行：
```bash
mkdir -p ~/.config/xhs-cover
```

再用 Write 工具写入 `~/.config/xhs-cover/config.json`：
```json
{
  "apiType": "google 或 third-party",
  "apiKey": "用户输入的key",
  "baseUrl": "对应的URL",
  "model": "对应的模型名",
  "outputDir": "用户输入或默认值",
  "defaultAspectRatio": "3:4"
}
```

写入后立即执行（保护 API Key 安全）：
```bash
chmod 600 ~/.config/xhs-cover/config.json
```

#### 1f. 测试 API 连通性

```bash
node ~/.claude/skills/xhs-cover/scripts/generate.mjs --test
```

- ✅ 成功 → 告知用户 Onboarding 完成，直接进入 Step 2
- ❌ 失败 → 告知错误原因，询问是否重新配置（Google 用户提示检查科学上网；第三方用户提示检查 URL 和 Key）

---

### Step 2：收集生成参数

读取当前配置：
```bash
cat ~/.config/xhs-cover/config.json
```

用 **一次** AskUserQuestion 收集所有必要参数（已在命令中提供的跳过）：

#### 必问项

**① 封面图片路径**（必填）
- 支持直接拖拽文件到终端，或粘贴绝对路径
- 提示：`支持 JPG/PNG，手机照片会自动修正方向`

**② 主标题**（必填）
- 封面最显眼的大字，例如：`如何用3个月学会Python`

#### 选问项（用一个 AskUserQuestion，多选/可选）

**③ 副标题**（可选）
- 补充说明文字，例如：`零基础入门+项目实战`

**④ 其他备注**（可选）
- 对风格、构图的额外要求，例如：`人物占比大，标签加上：进阶虾、学习虾`

**⑤ 比例**（单选，默认 3:4）
| 选项 | 说明 |
|------|------|
| 3:4（默认） | 小红书标准竖版，最常用 |
| 1:1 | 正方形，适合头像或九宫格 |
| 9:16 | 全屏竖版，适合视频封面 |
| 4:3 | 横版，适合横构图人像 |

**⑥ 生成张数**（默认 1，最多 5）

---

### Step 3：风格选择

用 AskUserQuestion 询问风格选择方式：

**选项 A：自动匹配**（推荐，根据你的标题内容自动选择最合适的风格）

**选项 B：从列表选择**（展示18种风格说明）

**选项 C：打开官网预览**（用户可先访问 https://xhscover.vivi.wiki 查看视觉效果，再回来输入风格ID）

---

#### 如果选 A（自动匹配）：

根据主标题和副标题内容，按以下规则推荐 **1-2种** 最合适的风格，并简要说明理由，然后 AskUserQuestion 让用户确认：

| 内容类型 | 推荐风格 |
|---------|---------|
| 职场/职业/工作/汇报/升职/面试 | `professional-clean`、`workplace-big-text`、`professional-woman` |
| 教程/干货/攻略/方法/步骤/指南 | `background-big-text`、`sticker-energy`、`multi-layer-layout` |
| 居家/生活/日常/厨房/家务 | `cozy-home`、`home-motivation`、`yellow-pink-banner` |
| 励志/正能量/突破/坚持/成长 | `dark-glow`、`home-motivation`、`dashed-decoration` |
| 旅行/户外/自由/清新 | `outdoor-handwriting`、`split-screen-tags` |
| 读书/知识/学习/智慧 | `study-room-intellectual`、`thinking-question` |
| 搞笑/综艺/有趣/年轻/网感 | `hand-drawn-border`、`sticker-energy`、`pink-yellow-playful` |
| 美妆/穿搭/女性/赋能 | `professional-woman`、`neon-contrast`、`pink-yellow-playful` |
| 科技/AI/播客/数字 | `background-big-text`、`dark-glow`、`workplace-big-text` |
| 其他/通用 | `hand-drawn-border`、`professional-clean` |

#### 如果选 B（列表选择）：

展示风格表（**同时展示官网链接，提醒用户可以在官网看效果图**）：

```
可在 https://xhscover.vivi.wiki 查看各风格效果图（点击风格卡片预览）

序号 | 风格ID | 名称 | 一句话描述
 1  | hand-drawn-border        | 手绘边框   | 黄色手绘描边，综艺活力感
 2  | outdoor-handwriting      | 户外手写   | 竖排毛笔黄字，清新自由感
 3  | neon-contrast            | 霓虹撞色   | 荧光粉绿大胆撞色，Y2K潮流
 4  | multi-layer-layout       | 多层排版   | 黑橙混排，杂志编辑风格
 5  | study-room-intellectual  | 书房知性   | 奶油色手写字，温暖智慧感
 6  | professional-woman       | 职场女性   | 奶黄大字+红色虚线，赋能感
 7  | sticker-energy           | 贴纸活力   | 人物抠图贴纸效果，闪电星星装饰
 8  | dashed-decoration        | 虚线装饰   | 白字橙副标，虚线半圆环绕
 9  | background-big-text      | 背景大字   | 超大橙字作背景，人物前景
10  | thinking-question        | 思考提问   | 蓝灰毛笔字，问号设计
11  | split-screen-tags        | 分屏标签   | 上图下色块，黄蓝配色
12  | cozy-home                | 温馨居家   | 黄白渐变字+椭圆高亮
13  | workplace-big-text       | 职场大字   | 白色超大字叠人物，冲击力
14  | dark-glow                | 深色发光   | 深色背景+黄色发光文字
15  | home-motivation          | 居家励志   | 亮黄大字，开放姿势场景
16  | yellow-pink-banner       | 黄粉横幅   | 黄字顶部+粉色横幅底部
17  | pink-yellow-playful      | 粉黄俏皮   | 波浪英文+手写中文，可爱
18  | professional-clean       | 专业简洁   | 白字简洁，现代办公场景
```

请用户输入序号或风格 ID。

#### 如果选 C（官网预览）：

```
请访问 https://xhscover.vivi.wiki 查看效果图。
每个风格卡片上都标有风格ID，看好后回来输入 ID 即可。
```

等待用户输入风格 ID 后继续。

---

### Step 4：运行生成

从配置文件读取 API 信息，构建命令：

```bash
node ~/.claude/skills/xhs-cover/scripts/generate.mjs \
  --image "图片绝对路径" \
  --style "风格ID" \
  --title "主标题" \
  --subtitle "副标题（如有）" \
  --extra "备注（如有）" \
  --count 张数 \
  --aspect-ratio "比例" \
  --output-dir "输出目录"
```

API 凭证由脚本自动从 `~/.config/xhs-cover/config.json` 读取，无需手动传入。

**生成多种风格时**：依次执行，每次之间 sleep 8（避免并发导致 TLS 断开）。

---

### Step 5：展示结果

生成成功后，用 Read 工具读取并展示每张图片，让用户直接在对话中预览。

对每张图展示：文件路径 + 预览图。

---

## 配置管理

### 修改 API 配置

如果用户说「重新配置」「修改 API key」「切换到 Google API」等，直接跳到 Step 1b 重新走配置流程，**不要删除已有配置**，直接覆盖写入。

### 查看当前配置

```bash
cat ~/.config/xhs-cover/config.json
```

输出时隐藏 apiKey 中间部分（只显示前8位和后4位）。

---

## 常见问题处理

**API Key 错误（401/403）**：
- Google：检查 Key 是否以 `AIza` 开头，科学上网是否正常
- 第三方：检查 Key 和 Base URL 是否匹配

**连接超时/TLS 断开**：
- 第三方 API 偶发网络问题，重试即可
- 不要并发运行多个生成请求

**图片太大压缩后仍失败**：
- 尝试提供分辨率较低的照片（手机拍摄 → 微信压缩后发给自己再用）

**生成结果文字出错**（多出随机文字）：
- 在 `--extra` 中加入：`严格只使用提供的标题，不要添加任何其他文字`

**Google API 不支持图片生成**：
- 确认模型是 `gemini-2.0-flash-exp-image-generation`，不是普通对话模型
