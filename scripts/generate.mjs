#!/usr/bin/env node
/**
 * 小红书封面生成脚本
 * 使用 VectorEngine / Gemini API 生成封面图片
 *
 * 用法：
 *   node generate.mjs --image <路径> --style <风格ID> --title <主标题> [选项]
 *
 * 选项：
 *   --image        人物照片路径（必填）
 *   --style        风格ID（必填，见下方列表）
 *   --title        主标题（必填）
 *   --subtitle     副标题（可选）
 *   --count        生成数量，默认1（最多5）
 *   --output-dir   输出目录，默认 ~/Desktop/XHS封面
 *   --api-key      API Key（也可从 ~/.config/xhs-cover/config.json 读取）
 *   --base-url     API 地址，默认 https://api.vectorengine.ai
 *   --model        模型名，默认 gemini-3-pro-image-preview
 *   --aspect-ratio 比例，默认 3:4（可选 1:1 / 4:3 / 9:16）
 *   --rotate       手动旋转角度：90 / 180 / 270（覆盖 EXIF 自动修正）
 *   --no-auto-orient  跳过 EXIF 自动旋转（上传横构图照片时使用）
 *   --test         只测试 API 连通性，不生成图片
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { execSync, spawnSync } from 'child_process';

// ─── 解析命令行参数 ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

// ─── 读取配置 ────────────────────────────────────────────────────────────────

const configPath = path.join(os.homedir(), '.config', 'xhs-cover', 'config.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch {}

const API_KEY      = getArg('api-key')       || config.apiKey       || process.env.VECTORENGINE_API_KEY || process.env.GEMINI_API_KEY;
const BASE_URL     = getArg('base-url')      || config.baseUrl      || 'https://api.vectorengine.ai';
const API_ENDPOINT = getArg('api-endpoint')  || config.apiEndpoint  || null; // 完整端点 URL（优先于 BASE_URL 拼接）
const MODEL        = getArg('model')         || config.model        || 'gemini-3-pro-image-preview';
const OUTPUT_DIR = getArg('output-dir')   || config.outputDir         || path.join(os.homedir(), 'Desktop', 'XHS封面');
const IMAGE_PATH = getArg('image');
const STYLE_ID   = getArg('style');
const TITLE      = getArg('title')        || '';
const SUBTITLE   = getArg('subtitle')     || '';
const COUNT      = Math.min(parseInt(getArg('count') || '1', 10), 5);
const RATIO           = getArg('aspect-ratio') || config.defaultAspectRatio || '3:4';
const EXTRA           = getArg('extra') || '';
const MANUAL_ROTATE   = getArg('rotate');         // '90' | '180' | '270'
const NO_AUTO_ORIENT  = hasFlag('no-auto-orient'); // 跳过 EXIF 修正
const TEST_MODE       = hasFlag('test');

// ─── 风格定义 ────────────────────────────────────────────────────────────────

const STYLES = {
  'hand-drawn-border': {
    name: '手绘边框',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中，占画面主体
- 主标题放在顶部，黑色粗体字，带黄色背景色块
- 副标题放在人物旁边或下方
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：黑色(#1A1A1A)粗黑体，字号超大，文字后面有黄色(#FFD93D)色块作为底色
- 副标题：黑色粗体
- 感叹号(!)作为强调元素，黑白相间设计

【核心特效 - 必须实现】
- 人物周围画黄色(#FFD93D)手绘线条描边，像马克笔随意画的轮廓
- 描边线条要松散、不规则，有手绘感
- 线条粗细约5-8像素

【装饰元素】
- 左侧添加黄色播放按钮图标
- 小箭头指向人物

【禁止事项】
- 不要添加任何对话气泡
- 不要出现"haha"、"nice girl"或任何与用户内容无关的随意文字
- 所有文字只使用用户提供的主标题和副标题

【氛围】活力、有趣、综艺感、年轻化`
  },

  'outdoor-handwriting': {
    name: '户外手写',
    prompt: `小红书封面设计。

【布局要求】
- 人物放在画面左侧，约占30%宽度
- 文字放在右侧，采用竖排排列（从上到下阅读）
- 文字分成两列纵向分布
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 所有文字使用黄色(#F7E03C)
- 字体：毛笔手写体/书法风格
- 笔触要有毛笔的粗细变化和飞白效果
- 文字边缘不要太整齐，要有手写的自然感

【核心特效 - 必须实现】
- 文字必须是竖排排列
- 添加黄色弧形箭头作为装饰，连接文字元素
- 文字旁边加小引号装饰("")

【背景要求】蓝天白云，绿色草地，光线明亮

【氛围】自由、清新、治愈、文艺`
  },

  'neon-contrast': {
    name: '霓虹撞色',
    prompt: `小红书封面设计。

【布局要求】
- 人物照片居中，占满大部分画面
- 整个画面外围有粗边框
- 主标题在顶部，副标题在底部
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：荧光绿色(#7FFF00)，粗黑体，超大号
- 副标题：荧光绿色(#7FFF00)，包含中文和拼音注释
- 用大括号{}包裹关键词

【核心特效 - 必须实现】
- 整个画面外围加粗的荧光粉色(#FF1493)边框，约20-30像素宽
- 必须使用荧光粉和荧光绿，颜色非常鲜艳

【装饰元素】右上角添加期数标签如"#01"，文字旁边加竖线装饰

【氛围】大胆、潮流、Y2K、Z世代`
  },

  'multi-layer-layout': {
    name: '多层排版',
    prompt: `小红书封面设计。

【布局要求】
- 人物放在右侧，约占60%画面
- 文字分多层排布在左侧和顶部
- 采用杂志编辑式的不对称布局
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：黑色(#1A1A1A)无衬线粗体
- 强调词：橙红色(#FF4D4D)
- 左侧边缘有竖排小字

【核心特效 - 必须实现】
- 文字大小层次分明，有大有小
- 橙红色感叹号(!)作为视觉焦点

【背景要求】浅灰色纯色背景

【氛围】专业、编辑感、知性`
  },

  'study-room-intellectual': {
    name: '书房知性',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中，半身照
- 文字分布在人物四周（左上、右上、左下、右下）
- 文字围绕人物但不遮挡脸部
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 所有文字使用浅黄色/奶油色(#F5E6A3)
- 字体：手写体/毛笔风格，字号较大

【核心特效 - 必须实现】
- 关键词下面加波浪线(~~~)装饰
- 整体色调温暖柔和

【背景要求】书房场景，有书架，暖色调灯光

【氛围】温暖、智慧、知性`
  },

  'professional-woman': {
    name: '职场女性',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中，主标题在顶部，副标题在底部，用引号包裹
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：奶黄色(#E8D57E)，粗黑体，超大号
- 副标题：奶黄色，用红色引号("")包裹

【核心特效 - 必须实现】
- 红色(#C41E3A)虚线弧线横穿画面
- 红色方块引号装饰""

【背景要求】室内场景，暖木色调

【氛围】自信、赋能、专业、女性力量`
  },

  'sticker-energy': {
    name: '贴纸活力',
    prompt: `小红书封面设计。

【布局要求】
- 主标题在顶部，呈弧形排列
- 人物在下半部分，做摊手或展示手势
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：黑色(#000000)超粗黑体
- 副标题有黄色(#FFE135)弧形底色

【核心特效 - 必须实现】
- 人物必须是抠图效果，周围有白色描边(3-5像素)，像贴纸一样贴在背景上
- 背景是点阵/网点图案

【装饰元素】黄色五角星贴纸⭐ 黄色闪电贴纸⚡

【氛围】活力、年轻、社交媒体感`
  },

  'dashed-decoration': {
    name: '虚线装饰',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中，面带微笑，主标题在顶部，副标题在底部用引号包裹
- 保持原始人像完全不变，只添加文字和装饰

【文字样式】
- 主标题：白色(#FFFFFF)，粗黑体，大号
- 副标题：橙色(#FF9500)，用橙色引号("")包裹
- 只使用中文文字，不要添加英文或拼音

【核心特效 - 必须实现】
- 白色虚线(- - -)画成半圆弧线，环绕人物头部和肩膀，从左上绕到右下

【背景要求】室内场景，米色/奶油色调，柔和光

【氛围】自信、优雅、温和`
  },

  'background-big-text': {
    name: '背景大字',
    prompt: `小红书封面设计。

【布局要求】
- 超大文字作为背景层，人物在前景
- 文字要被人物部分遮挡
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 背景大字：橙色(#FF6B35)，超粗黑体，占画面80%
- 文字放在人物后面（人物遮挡部分文字）
- 副标题用【】中括号包裹

【核心特效 - 必须实现】
- 大字必须在人物后面作为背景，人物覆盖在文字上方

【禁止事项】
- 主标题只出现一次，绝对不要在画面任何位置重复相同文字
- 副标题也只出现一次
- 不要出现任何与用户内容无关的随意文字

【背景要求】浅灰白色背景

【氛围】教学、专业、有冲击力`
  },

  'thinking-question': {
    name: '思考提问',
    prompt: `小红书封面设计。

【布局要求】
- 人物在左侧，做思考姿势（手托下巴）
- 文字散落在右侧和上方，文字排列不规则，有大有小
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 所有文字使用蓝灰色(#5B7A8A)，字体：毛笔手写体
- 问号(?)作为重要元素，要大且醒目

【核心特效 - 必须实现】
- 虚线从人物延伸出来，连接到文字
- 文字要有毛笔的笔触感

【背景要求】纯白色背景

【氛围】思考、疑问、探讨、理性`
  },

  'split-screen-tags': {
    name: '分屏标签',
    prompt: `小红书封面设计。

【布局要求】
- 上半部分60%是人物照片，下半部分40%是纯色色块（分屏设计）
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 顶部文字：黄色(#F7E54D)和浅蓝色(#8DD3E8)混合，手写体
- 下方色块内文字：黄色手写体，关键词上方加拼音标注

【核心特效 - 必须实现】
- 下半部分必须是棕色(#6B4C3B)纯色块
- 人物周围有黄色虚线边框装饰
- 分割线用斜线(/////)

【氛围】自由、转变、轻松、真实分享`
  },

  'cozy-home': {
    name: '温馨居家',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中偏右，手持物品（如咖啡杯）
- 主标题在顶部，底部文字用椭圆高亮
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：黄白渐变色(#F5D547)，粗黑体，数字要突出
- 关键词用黄色椭圆圈起来

【核心特效 - 必须实现】
- 底部关键词外面画黄色椭圆形边框，椭圆是手绘风格，线条不完全闭合

【背景要求】温馨居家场景，有沙发、木质家具、绿植，暖色调

【氛围】温馨、生活化、平衡、舒适`
  },

  'workplace-big-text': {
    name: '职场大字',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中，超大文字覆盖整个画面，叠加在人物上
- 上方文字和下方文字把人物夹在中间
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题（上方和下方）：纯白色(#FFFFFF)，超粗黑体，巨大
- 副标题（中间）：黄色(#FFE500)，中等大小

【核心特效 - 必须实现】
- 文字必须非常大，占画面40%以上，直接覆盖在人物身上
- 白色文字要有轻微阴影增加立体感

【背景要求】室内办公场景，略微模糊，灰白色调

【氛围】专业、有冲击力、自信、职场感`
  },

  'dark-glow': {
    name: '深色发光',
    prompt: `小红书封面设计。

【布局要求】
- 人物在下半部分，积极姿势（如竖大拇指）
- 大标题在顶部，副标题在中间和底部
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：黄色(#FFE135)，粗黑体，有发光效果
- 问号(?)用黄色，也要发光
- 副标题：白色(#FFFFFF)，粗体

【核心特效 - 必须实现】
- 文字必须有外发光效果（glow），发光颜色是淡黄色
- 背景必须是深色/暗色调

【背景要求】深色背景，有一些暖色光源点缀，整体偏暗

【氛围】希望、积极、突破困境、正能量`
  },

  'home-motivation': {
    name: '居家励志',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中，做开放姿势（如张开双臂），大标题分布在人物上下方
- 只使用中文文字，不要添加英文标签
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：亮黄色(#FFF44F)，超粗黑体，非常大
- 底部小字：白色，用括号()标注

【核心特效 - 必须实现】
- 文字要非常大，占画面很大比例

【背景要求】居家场景，客厅/餐厅，有家具、绿植，光线明亮温馨

【氛围】鼓励、乐观、生活智慧、温暖`
  },

  'yellow-pink-banner': {
    name: '黄粉横幅',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中，占画面主体，主标题在顶部超大字号
- 副标题在底部，用粉色横幅承载
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：亮黄色(#FFE135)，超粗黑体，字号非常大
- 副标题：白色(#FFFFFF)文字，放在粉红色(#FF1493)横幅上
- 横幅是实心色块，不透明

【核心特效 - 必须实现】
- 顶部黄色文字非常醒目，占画面上方1/3
- 底部粉色横幅横跨整个画面宽度，高度约占画面1/6

【背景要求】温馨居家场景，暖色调灯光

【氛围】温馨、科技感、生活化`
  },

  'pink-yellow-playful': {
    name: '粉黄俏皮',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中，半身照，手势自然
- 顶部大字英文标题，左侧和右侧分布中文文字
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 顶部英文：亮黄色(#FFE135)，粗体，字母呈波浪状排列，有动感
- 左侧中文：粉红色(#FF69B4)，手写体风格，竖排或斜排
- 右侧中文：亮黄色(#FFE135)，手写体风格

【核心特效 - 必须实现】
- 英文字母要有波浪起伏效果，不是直线排列
- 中文文字要有手写的随意感

【装饰元素】可以添加小星星、爱心等可爱装饰

【背景要求】室内场景，背景略微模糊，柔和自然光

【氛围】俏皮、可爱、亲和、年轻活力`
  },

  'professional-clean': {
    name: '专业简洁',
    prompt: `小红书封面设计。

【布局要求】
- 人物居中偏下，全身照或大半身照，主标题在顶部简洁有力
- 保持原始人像完全不变，只添加文字和装饰，不要修改人脸

【文字样式】
- 主标题：纯白色(#FFFFFF)，粗黑体，大字号
- 文字排列整齐，左对齐或居中，字体简洁现代，无装饰

【核心特效 - 必须实现】
- 文字要有轻微阴影或描边，确保在背景上清晰可见
- 不要添加过多装饰，保持简洁专业

【背景要求】现代办公室场景，有玻璃隔断，暖色调木质元素，背景略微虚化

【氛围】专业、自信、现代、干练、高级感`
  }
};

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  return map[ext] || 'image/jpeg';
}

/**
 * 读取图片 EXIF 方向标签（仅 macOS sips 可用）
 * 返回 1（正常）| 3（180°）| 6（需顺时针90°）| 8（需逆时针90°）
 */
function getExifOrientation(filePath) {
  try {
    const result = spawnSync('sips', ['-g', 'orientation', filePath], { encoding: 'utf8' });
    const match = result.stdout?.match(/orientation:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  } catch { return 1; }
}

/**
 * 修正图片方向，输出临时文件路径。
 * - 默认：读取 EXIF 自动修正（手机照片几乎都需要这步）
 * - noAutoOrient=true：跳过修正（横构图内容照片）
 * - manualDeg：强制旋转指定角度（覆盖 EXIF 检测）
 */
function normalizeImageOrientation(filePath, { noAutoOrient, manualDeg, tmpDir }) {
  const tmpPath = path.join(tmpDir, `_normalized_${Date.now()}.jpg`);

  // 手动旋转优先
  if (manualDeg) {
    execSync(`sips -r ${manualDeg} "${filePath}" --out "${tmpPath}"`, { stdio: 'pipe' });
    return tmpPath;
  }

  // 跳过自动修正
  if (noAutoOrient) {
    fs.copyFileSync(filePath, tmpPath);
    return tmpPath;
  }

  // 读取 EXIF 并修正
  const orientation = getExifOrientation(filePath);
  // EXIF 方向 → 需要旋转的角度（将像素旋转到正视方向）
  const rotationMap = { 1: 0, 3: 180, 6: 90, 8: 270 };
  const deg = rotationMap[orientation] ?? 0;

  // 旋转 + 缩放（长边不超过 1920px）+ 压缩（sips 默认 jpeg 质量约 80%）
  const sipsArgs = [filePath, '--out', tmpPath, '--resampleHeightWidthMax', '1920', '-s', 'format', 'jpeg', '-s', 'formatOptions', '85'];
  if (deg !== 0) sipsArgs.splice(1, 0, '-r', String(deg));
  execSync(`sips ${sipsArgs.map(a => `"${a}"`).join(' ')}`, { stdio: 'pipe' });
  spawnSync('sips', ['-s', 'orientation', '1', tmpPath], { stdio: 'pipe' });

  return tmpPath;
}

// ─── HTTP 工具（强制 HTTP/1.1，兼容 VectorEngine）────────────────────────────

function httpsPost(urlStr, headers, bodyObj, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`));
        } else {
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error(`JSON 解析失败: ${text.slice(0, 200)}`)); }
        }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`请求超时（>${Math.round(timeoutMs/1000)}s）`)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── API 调用 ────────────────────────────────────────────────────────────────

async function generateImage({ apiKey, baseUrl, apiEndpoint, model, imageBase64, mimeType, prompt, aspectRatio }) {
  const url = apiEndpoint || `${baseUrl}/v1/chat/completions`;
  const headers = { 'Authorization': `Bearer ${apiKey}` };

  const result = await httpsPost(url, headers, {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: prompt }
      ]
    }],
    response_modalities: ['image', 'text']
  });

  // 解析 markdown 图片格式：![image](data:image/png;base64,...)
  const content = result?.choices?.[0]?.message?.content || '';
  if (typeof content === 'string') {
    const match = content.match(/!\[.*?\]\(data:([^;]+);base64,([A-Za-z0-9+/=\s]+)\)/);
    if (match) {
      return { data: match[2].replace(/\s/g, ''), mimeType: match[1] };
    }
  }

  // 解析 images 数组格式（Cloudsway 风格）
  const images = result?.choices?.[0]?.message?.images;
  if (Array.isArray(images) && images.length > 0) {
    const imgUrl = images[0]?.image_url?.url;
    if (imgUrl) {
      const m = imgUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (m) return { data: m[2].replace(/\s/g, ''), mimeType: m[1] };
    }
  }

  // 解析 Gemini 原生格式（备用）
  if (result?.candidates?.[0]?.content?.parts) {
    for (const part of result.candidates[0].content.parts) {
      if (part?.inlineData?.data) {
        return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
      }
    }
  }

  throw new Error(`响应中未找到图片数据。响应预览: ${JSON.stringify(result).slice(0, 300)}`);
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

async function main() {
  // 测试模式
  if (TEST_MODE) {
    if (!API_KEY) { console.error('❌ 未提供 API Key'); process.exit(1); }
    const url = API_ENDPOINT || `${BASE_URL}/v1/chat/completions`;
    console.log(`🔍 测试 API 连通性...`);
    console.log(`   URL: ${url}`);
    console.log(`   Model: ${MODEL}`);
    console.log(`   Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`);
    try {
      await httpsPost(url,
        { 'Authorization': `Bearer ${API_KEY}` },
        { model: MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 },
        20_000
      );
      console.log(`✅ API 连通正常`);
    } catch (e) {
      console.error(`❌ 连接失败: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // 参数校验
  if (!API_KEY)    { console.error('❌ 未提供 API Key（--api-key 或配置文件）'); process.exit(1); }
  if (!IMAGE_PATH) { console.error('❌ 未提供图片路径（--image）'); process.exit(1); }
  if (!STYLE_ID)   { console.error('❌ 未提供风格ID（--style）\n可用风格：\n' + Object.entries(STYLES).map(([id, s]) => `  ${id} - ${s.name}`).join('\n')); process.exit(1); }
  if (!TITLE)      { console.error('❌ 未提供主标题（--title）'); process.exit(1); }

  const style = STYLES[STYLE_ID];
  if (!style) {
    console.error(`❌ 未知风格ID: ${STYLE_ID}\n可用风格：\n` + Object.keys(STYLES).map(id => `  ${id} - ${STYLES[id].name}`).join('\n'));
    process.exit(1);
  }

  // 读取图片
  const resolvedImage = expandHome(IMAGE_PATH);
  if (!fs.existsSync(resolvedImage)) {
    console.error(`❌ 图片文件不存在: ${resolvedImage}`);
    process.exit(1);
  }

  // 修正图片方向（EXIF 自动修正，或手动旋转）
  const tmpDir = os.tmpdir();
  const exifOrientation = NO_AUTO_ORIENT ? 1 : getExifOrientation(resolvedImage);
  const needsCorrection = MANUAL_ROTATE || (!NO_AUTO_ORIENT && exifOrientation !== 1);

  let imagePath = resolvedImage;
  let tmpFile = null;
  if (needsCorrection) {
    process.stdout.write(`🔄 修正图片方向（EXIF: ${exifOrientation}${MANUAL_ROTATE ? `, 手动旋转: ${MANUAL_ROTATE}°` : ''}）...`);
    tmpFile = normalizeImageOrientation(resolvedImage, {
      noAutoOrient: NO_AUTO_ORIENT,
      manualDeg: MANUAL_ROTATE,
      tmpDir,
    });
    imagePath = tmpFile;
    process.stdout.write(' 完成\n');
  }

  const imageSizeBytes = fs.statSync(imagePath).size;
  if (imageSizeBytes > 4 * 1024 * 1024) {
    // 尝试进一步压缩
    process.stdout.write(`⚠️  图片较大（${(imageSizeBytes/1024/1024).toFixed(1)}MB），自动压缩...`);
    const compressed = path.join(tmpDir, `_compressed_${Date.now()}.jpg`);
    execSync(`sips "${imagePath}" --out "${compressed}" --resampleHeightWidthMax 1200 -s format jpeg -s formatOptions 75`, { stdio: 'pipe' });
    if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    tmpFile = compressed;
    imagePath = compressed;
    process.stdout.write(` ${(fs.statSync(imagePath).size/1024/1024).toFixed(1)}MB\n`);
  }

  const imageBase64 = fs.readFileSync(imagePath, 'base64');
  const mimeType = detectMimeType(imagePath);

  // 构建 prompt
  const textPart = [
    TITLE    ? `主标题：${TITLE}` : '',
    SUBTITLE ? `副标题：${SUBTITLE}` : ''
  ].filter(Boolean).join('\n');

  const fullPrompt = `${style.prompt}\n\n【文字内容 - 使用以下文字】\n${textPart}${EXTRA ? '\n\n【额外要求】\n' + EXTRA : ''}`;

  // 准备输出目录
  const resolvedOutputDir = expandHome(OUTPUT_DIR);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  console.log(`\n🎨 风格：${style.name} (${STYLE_ID})`);
  console.log(`📝 主标题：${TITLE}${SUBTITLE ? ' / 副标题：' + SUBTITLE : ''}`);
  console.log(`📐 比例：${RATIO}  |  数量：${COUNT} 张`);
  console.log(`🔑 API：${BASE_URL} / ${MODEL}`);
  console.log('');

  let successCount = 0;

  for (let i = 1; i <= COUNT; i++) {
    const label = COUNT > 1 ? ` (${i}/${COUNT})` : '';
    process.stdout.write(`⏳ 生成中${label}...`);
    const startTime = Date.now();

    try {
      const result = await generateImage({
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        apiEndpoint: API_ENDPOINT,
        model: MODEL,
        imageBase64,
        mimeType,
        prompt: fullPrompt,
        aspectRatio: RATIO
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `cover_${style.name}_${timestamp}_${i}.${ext}`;
      const outputPath = path.join(resolvedOutputDir, fileName);

      fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
      process.stdout.write(`\r✅ 已生成${label}（${elapsed}s）: ${outputPath}\n`);
      successCount++;
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r❌ 生成失败${label}（${elapsed}s）: ${err.message}\n`);
    }
  }

  // 清理临时文件
  if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}

  console.log(`\n完成：${successCount}/${COUNT} 张成功，保存在 ${resolvedOutputDir}`);
  if (successCount === 0) process.exit(1);
}

main().catch(err => {
  console.error('❌ 未知错误:', err.message);
  process.exit(1);
});
