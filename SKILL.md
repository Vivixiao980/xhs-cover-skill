---
name: xhs-cover
description: >
  Generate Xiaohongshu (XHS / RedNote) cover images using Gemini API.
  Triggers for cover generation: "生成封面", "小红书封面", "xhs封面", "制作封面",
  "帮我做张图", "XHS cover", "RedNote cover".
  Triggers for style learning: "学习这个风格", "提取风格", "我想自定义风格",
  "这张图的风格", "learn this style", "extract style".
  Always trigger this skill when user mentions 小红书/XHS/RedNote together
  with 封面/cover/图片, OR when user uploads a reference image and asks
  about creating a similar style.
metadata:
  openclaw:
    requires:
      bins:
        - node
    primaryEnv: XHS_COVER_API_KEY
    emoji: "🎨"
---

# 小红书封面生成器

在命令行直接生成小红书封面，无需打开网站。

- **官网**：https://xhscover.vivi.wiki（可在线预览所有风格效果图）
- **作者**：Vivi
- **支持风格**：18种预设风格 + 用户自定义风格
- **技术原理**：调用 Gemini 图片生成模型，将你的人像照片 + 文字要求合成为封面图

---

## 路径约定

本 Skill 的脚本位于 SKILL.md 所在目录。执行任何命令前，先确定 `SKILL_DIR`：

- **Claude Code**：`~/.claude/skills/xhs-cover`
- **OpenClaw**：`~/.openclaw/skills/xhs-cover`

后续所有 `${SKILL_DIR}` 均指此路径，不要硬编码。

---

## 工作流入口

触发后，先判断用户意图：

- **生成封面**（默认）：用户想用已有风格生成封面 → 进入下方「执行流程」
- **学习/提取风格**：用户上传了参考图，或说了「学习/提取/自定义风格」→ 跳到「风格学习工作流」
- **使用自定义风格**：用户说「用 XX 风格生成」且 XX 不在内置列表中 → 检查 `styles/` 目录是否有对应 JSON；有则使用，无则建议先运行风格学习工作流

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

> 💡 **OpenClaw 用户**：可跳过 Onboarding，直接在 OpenClaw 配置文件中设置环境变量：
> ```yaml
> skills:
>   entries:
>     xhs-cover:
>       env:
>         XHS_COVER_API_KEY: "你的 API Key"
>         XHS_COVER_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai"
>         XHS_COVER_MODEL: "gemini-2.0-flash-exp-image-generation"
> ```
> 设置后重启 OpenClaw 即可，无需走以下步骤。

用 AskUserQuestion 询问（**必须先问这个，再问 key**）：

**问题**："请选择 API 来源"

| 选项 | 说明 |
|------|------|
| Google AI Studio（官方） | 使用谷歌官方 API，有免费层级（无需绑卡），但图片生成是否免费请以官方定价页为准，需要科学上网 |
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

注意：Gemini API 有免费层级，但图片生成功能是否免费以 https://ai.google.dev/gemini-api/docs/pricing 为准（Google 定价会随版本更新调整）。
```

用 AskUserQuestion 询问：
- **API Key**（必填，以 AIza 开头）

然后自动设定：
- `baseUrl` = `https://generativelanguage.googleapis.com/v1beta/openai`
- `model` = 当前支持图片生成的模型名（Google 会随版本迭代更新，可在 https://ai.google.dev/gemini-api/docs/models 查询最新名称）

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
node ${SKILL_DIR}/scripts/generate.mjs --test
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
node ${SKILL_DIR}/scripts/generate.mjs \
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

---

## 风格学习工作流

让用户把喜欢的封面图「教」给 Skill，提取成可复用的风格模板，并可选择贡献到社区。

### Phase 1：上传与分析

1. 请用户上传 1-5 张参考图（支持 PNG / JPG / WebP）
   - 0 张：提示「至少需要 1 张参考图」
   - 超过 5 张：选取视觉差异最大的 5 张，说明原因

2. 用 Read 工具读取每张图片，分析以下维度：
   - **配色**：主色、辅色、点缀色（尽量给出 hex 值）、整体色彩情绪
   - **字体感**：粗细（轻/常规/粗）、风格（无衬线/衬线/手写/装饰）、大小层级
   - **构图**：文字与人物的位置关系、文字占比、留白多少、对齐方式
   - **装饰元素**：有无边框、贴纸、图标、几何图形、背景纹理
   - **整体氛围**：用 2-3 个关键词概括（如「温暖、治愈、ins 风」）

3. 如果多张图风格冲突，明确指出冲突点，请用户选择方向，而不是取平均

4. 向用户展示分析结果（用自然语言，不要直接甩 JSON）：
   > 我从你的图片中提取了这些风格特征：
   > - 配色：暖奶油底色，深棕文字，粉色点缀
   > - 字体：标题超大粗体，副标题细小，对比强烈
   > - 构图：人物居中，标题压在头顶，底部色块横幅
   > - 氛围：温暖、生活感、小红书爆款风
   >
   > 你觉得这些对吗？有没有想调整的地方？

### Phase 2：确认与生成 Prompt

1. 用户确认分析结果（允许最多 3 轮调整）
   - 「颜色再亮一点」→ 调整配色描述
   - 「想要更简约」→ 减少装饰元素
   - 「字体感觉不对」→ 进一步询问偏好

2. 请用户为这个风格起个名字（建议基于氛围关键词，如「暖橙励志」）

3. 根据分析结果，生成对应的风格 prompt，格式与内置风格完全一致：

   ```json
   {
     "name": "用户起的中文名",
     "prompt": "根据分析结果撰写的图片生成提示词..."
   }
   ```

   Prompt 撰写要点：
   - 明确【文字区域划分】（主标题在哪、副标题在哪）
   - 明确【字体风格】（参考分析结果翻译成生图描述语言）
   - 明确【背景/场景】
   - 结尾加【禁止事项】（禁止多余文字、禁止修改人脸）

4. 把生成的 JSON 保存到 `styles/` 目录：

   ```bash
   # 文件名用英文，与内置风格格式一致
   # 例如：styles/warm-orange-motivation.json
   ```

   用 Write 工具写入文件。

5. 确认：「✅ 风格『{name}』已保存！下次生成时直接选择这个风格就行。」

### Phase 3：测试生成

1. 询问用户：「要不要用这个风格试生成一张看看效果？」

2. 如果是，收集测试内容（或使用默认标题「5 个让生活变好的小习惯」）

3. 用 Bash 工具运行生成：

   ```bash
   node ${SKILL_DIR}/scripts/generate.mjs \
     --image "用户提供的照片路径" \
     --style "刚才保存的风格ID（文件名去掉.json）" \
     --title "测试标题" \
     --aspect-ratio "3:4" \
     --output-dir "/tmp/xhs-style-test"
   ```

4. 用 Read 工具展示生成结果，和原参考图放在一起让用户对比

5. 如果不满意：找出哪个维度有偏差，回到 Phase 2 修改 prompt，最多迭代 3 次
   - 3 次后仍不满意：「可以先保存当前版本，之后随时再优化」

6. 满意后继续 Phase 4

### Phase 4：贡献到社区（可选）

1. 询问用户：
   > 你的风格效果很棒！想不想把它分享给社区，让其他人也能用？
   > 只需要提交一个 PR，你的名字会出现在贡献者列表里。

2. 如果愿意，收集以下信息：
   - **贡献者名字**（显示在 PR 和文件注释中）
   - **风格简介**（一句话，例如「暖橙色调，适合励志、职场内容」）
   - **标签**（3-5 个，例如：励志、职场、暖色）

3. 在 `styles/` 目录里当前风格 JSON 文件顶部，追加 metadata 注释：

   ```json
   {
     "name": "暖橙励志",
     "author": "贡献者名字",
     "description": "暖橙色调，适合励志、职场内容",
     "tags": ["励志", "职场", "暖色"],
     "prompt": "..."
   }
   ```

4. 把 Phase 3 生成的测试图保存为 `assets/styles/{风格ID}.jpg`（作为预览图）

5. 引导用户提交 PR：

   **非技术用户**：
   > 1. 打开 https://github.com/Vivixiao980/xhs-cover-skill
   > 2. 进入 `styles/` 文件夹，点右上角「Add file」→「Upload files」
   > 3. 上传你的 `{风格ID}.json` 文件
   > 4. 同样操作，把预览图上传到 `assets/styles/` 文件夹
   > 5. 在页面底部填写说明（如「新增风格：暖橙励志」），点「Propose changes」
   > 6. 在下一页点「Create pull request」就完成了！

   **技术用户**：
   ```bash
   # fork 仓库后：
   git checkout -b style/warm-orange-motivation
   git add styles/warm-orange-motivation.json assets/styles/warm-orange-motivation.jpg
   git commit -m "feat: add warm-orange-motivation style"
   git push origin style/warm-orange-motivation
   # 然后在 GitHub 上提交 PR
   ```

6. 如果不愿意贡献：
   > 没问题！风格已保存在本地，随时可以用。想分享的时候再告诉我。

### 错误处理

- **参考图分辨率过低**（短边 < 500px）：提醒用户分析精度可能下降，建议换高清图
- **参考图不是封面设计**（纯照片、无排版元素）：说明此工作流需要有文字设计的封面图，纯人像照适合直接去生成封面
- **用户中途放弃**：告知当前进度已到哪一步，风格文件是否已保存，下次可以从哪里继续