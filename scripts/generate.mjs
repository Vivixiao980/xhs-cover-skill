#!/usr/bin/env node
/**
 * 小红书封面生成脚本
 * 跨平台：使用 sharp 处理图片（macOS / Linux / Windows）
 *
 * 用法：
 *   node generate.mjs --image <路径> --style <风格ID> --title <主标题> [选项]
 *
 * 选项：
 *   --image           人物照片路径（必填）
 *   --style           风格ID（必填，见 styles/ 目录）
 *   --title           主标题（必填）
 *   --subtitle        副标题（可选）
 *   --extra           额外要求（可选）
 *   --count           生成数量，默认1（最多5）
 *   --output-dir      输出目录，默认 ~/Desktop/XHS封面
 *   --api-key         API Key（也可从 ~/.config/xhs-cover/config.json 读取）
 *   --base-url        API Base URL
 *   --api-endpoint    完整端点 URL（优先于 base-url，Google AI Studio 适用）
 *   --model           模型名
 *   --aspect-ratio    比例，默认 3:4（可选 1:1 / 4:3 / 9:16）
 *   --rotate          手动旋转角度：90 / 180 / 270
 *   --no-auto-orient  跳过 EXIF 自动旋转
 *   --retries         失败重试次数，默认 2
 *   --test            只测试 API 连通性，不生成图片
 *
 * Exit codes:
 *   0  成功
 *   1  参数/配置错误
 *   2  API 认证失败（401/403）
 *   3  API 超时
 *   4  网络错误
 *   5  响应中无图片数据
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 检查 sharp ───────────────────────────────────────────────────────────────

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('❌ 缺少依赖 sharp，请在 Skill 目录运行：npm install');
  console.error('   cd ~/.claude/skills/xhs-cover && npm install');
  process.exit(1);
}

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

const API_KEY      = getArg('api-key')      || config.apiKey      || process.env.GEMINI_API_KEY;
const BASE_URL     = getArg('base-url')     || config.baseUrl     || 'https://api.vectorengine.ai';
const API_ENDPOINT = getArg('api-endpoint') || config.apiEndpoint || null;
const MODEL        = getArg('model')        || config.model       || 'gemini-3-pro-image-preview';
const OUTPUT_DIR   = getArg('output-dir')   || config.outputDir   || path.join(os.homedir(), 'Desktop', 'XHS封面');
const IMAGE_PATH   = getArg('image');
const STYLE_ID     = getArg('style');
const TITLE        = getArg('title')        || '';
const SUBTITLE     = getArg('subtitle')     || '';
const COUNT        = Math.min(parseInt(getArg('count') || '1', 10), 5);
const RATIO        = getArg('aspect-ratio') || config.defaultAspectRatio || '3:4';
const EXTRA        = getArg('extra')        || '';
const MANUAL_ROTATE   = getArg('rotate');
const NO_AUTO_ORIENT  = hasFlag('no-auto-orient');
const MAX_RETRIES     = parseInt(getArg('retries') || '2', 10);
const TEST_MODE       = hasFlag('test');

// ─── 动态加载风格 ────────────────────────────────────────────────────────────

const stylesDir = path.join(__dirname, '..', 'styles');
const STYLES = {};
try {
  for (const file of fs.readdirSync(stylesDir).filter(f => f.endsWith('.json'))) {
    const id = file.replace('.json', '');
    STYLES[id] = JSON.parse(fs.readFileSync(path.join(stylesDir, file), 'utf-8'));
  }
} catch (e) {
  console.error(`❌ 无法加载风格文件（${stylesDir}）: ${e.message}`);
  process.exit(1);
}

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
 * 使用 sharp 处理图片：EXIF 自动旋转 + 缩放 + 压缩
 * 跨平台，替代 macOS 专属的 sips
 */
async function normalizeImage(filePath, { noAutoOrient, manualDeg, tmpDir }) {
  const tmpPath = path.join(tmpDir, `_normalized_${Date.now()}.jpg`);
  let pipeline = sharp(filePath);

  if (manualDeg) {
    // 手动旋转：先 EXIF 修正，再叠加手动角度
    pipeline = pipeline.rotate().rotate(parseInt(manualDeg, 10));
  } else if (noAutoOrient) {
    // 跳过 EXIF 修正，原始方向
  } else {
    // 自动 EXIF 修正（sharp 内置，无需读取 EXIF tag）
    pipeline = pipeline.rotate();
  }

  await pipeline
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(tmpPath);

  return tmpPath;
}

/**
 * 进一步压缩超大图片（>4MB）
 */
async function compressImage(filePath, tmpDir) {
  const tmpPath = path.join(tmpDir, `_compressed_${Date.now()}.jpg`);
  await sharp(filePath)
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toFile(tmpPath);
  return tmpPath;
}

// ─── HTTP 工具（强制 HTTP/1.1，兼容各类 OpenAI 兼容端点）───────────────────

function httpsPost(urlStr, headers, bodyObj, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode === 401 || res.statusCode === 403) {
          const err = new Error(`认证失败（HTTP ${res.statusCode}）：请检查 API Key 是否正确`);
          err.code = 'AUTH_ERROR';
          return reject(err);
        }
        if (res.statusCode >= 500) {
          const err = new Error(`服务端错误（HTTP ${res.statusCode}）：${text.slice(0, 200)}`);
          err.code = 'SERVER_ERROR';
          err.retryable = true;
          return reject(err);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`);
          err.code = 'HTTP_ERROR';
          return reject(err);
        }
        try { resolve(JSON.parse(text)); }
        catch { reject(Object.assign(new Error(`JSON 解析失败: ${text.slice(0, 200)}`), { code: 'PARSE_ERROR' })); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(Object.assign(new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`), { code: 'TIMEOUT', retryable: true }));
    });
    req.on('error', (e) => {
      reject(Object.assign(e, { code: e.code || 'NETWORK_ERROR', retryable: true }));
    });
    req.write(body);
    req.end();
  });
}

// ─── API 调用（含重试）───────────────────────────────────────────────────────

async function generateImage({ apiKey, baseUrl, apiEndpoint, model, imageBase64, mimeType, prompt, aspectRatio, retries = MAX_RETRIES }) {
  const url = apiEndpoint || `${baseUrl}/v1/chat/completions`;
  const headers = { 'Authorization': `Bearer ${apiKey}` };
  const ratioMap = { '3:4': '竖版3:4比例（宽:高）', '1:1': '正方形1:1比例', '9:16': '竖版9:16比例', '4:3': '横版4:3比例' };
  const ratioHint = ratioMap[aspectRatio] || '竖版3:4比例';
  const fullPrompt = `${prompt}\n\n【输出规格】生成${ratioHint}的图片。`;

  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: fullPrompt },
      ],
    }],
    response_modalities: ['image', 'text'],
  };

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 5000;
      process.stdout.write(` 重试 ${attempt}/${retries}（等待 ${delay / 1000}s）...`);
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      const result = await httpsPost(url, headers, body);

      // Format 1: markdown image in content string
      const content = result?.choices?.[0]?.message?.content || '';
      if (typeof content === 'string') {
        const match = content.match(/!\[.*?\]\(data:([^;]+);base64,([A-Za-z0-9+/=\s]+)\)/s);
        if (match) return { data: match[2].replace(/\s/g, ''), mimeType: match[1] };
      }
      // Format 2: images array
      const images = result?.choices?.[0]?.message?.images;
      if (Array.isArray(images) && images.length > 0) {
        const imgUrl = images[0]?.image_url?.url;
        if (imgUrl) {
          const m = imgUrl.match(/^data:([^;]+);base64,(.+)$/s);
          if (m) return { data: m[2].replace(/\s/g, ''), mimeType: m[1] };
        }
      }
      // Format 3: Gemini native
      if (result?.candidates?.[0]?.content?.parts) {
        for (const part of result.candidates[0].content.parts) {
          if (part?.inlineData?.data) return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
        }
      }

      lastError = Object.assign(
        new Error(`响应中未找到图片数据。预览: ${JSON.stringify(result).slice(0, 300)}`),
        { code: 'NO_IMAGE', retryable: false }
      );
      break; // 格式错误不重试
    } catch (e) {
      lastError = e;
      if (!e.retryable) break;
    }
  }
  throw lastError;
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
      process.exit(e.code === 'AUTH_ERROR' ? 2 : e.code === 'TIMEOUT' ? 3 : 4);
    }
    return;
  }

  // 参数校验
  if (!API_KEY)    { console.error('❌ 未提供 API Key（--api-key 或配置文件）'); process.exit(1); }
  if (!IMAGE_PATH) { console.error('❌ 未提供图片路径（--image）'); process.exit(1); }
  if (!STYLE_ID)   {
    console.error('❌ 未提供风格ID（--style）\n可用风格：\n' + Object.entries(STYLES).map(([id, s]) => `  ${id} - ${s.name}`).join('\n'));
    process.exit(1);
  }
  if (!TITLE)      { console.error('❌ 未提供主标题（--title）'); process.exit(1); }

  const style = STYLES[STYLE_ID];
  if (!style) {
    console.error(`❌ 未知风格: ${STYLE_ID}\n可用风格：\n` + Object.keys(STYLES).map(id => `  ${id} - ${STYLES[id].name}`).join('\n'));
    process.exit(1);
  }

  // 读取图片
  const resolvedImage = expandHome(IMAGE_PATH);
  if (!fs.existsSync(resolvedImage)) {
    console.error(`❌ 图片文件不存在: ${resolvedImage}`);
    process.exit(1);
  }
  const ext = path.extname(resolvedImage).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    console.error(`❌ 不支持的图片格式: ${ext}（支持 JPG / PNG / WebP）`);
    process.exit(1);
  }

  // 处理图片方向 + 压缩
  const tmpDir = os.tmpdir();
  let imagePath = resolvedImage;
  let tmpFiles = [];

  process.stdout.write(`🔄 处理图片（EXIF旋转+压缩）...`);
  try {
    const normalized = await normalizeImage(resolvedImage, {
      noAutoOrient: NO_AUTO_ORIENT,
      manualDeg: MANUAL_ROTATE,
      tmpDir,
    });
    tmpFiles.push(normalized);
    imagePath = normalized;
    process.stdout.write(` ✓\n`);
  } catch (e) {
    process.stdout.write(`\n⚠️  图片处理失败（${e.message}），使用原图\n`);
  }

  // 超大图再压缩
  const imageSizeBytes = fs.statSync(imagePath).size;
  if (imageSizeBytes > 4 * 1024 * 1024) {
    process.stdout.write(`⚠️  图片较大（${(imageSizeBytes / 1024 / 1024).toFixed(1)}MB），进一步压缩...`);
    try {
      const compressed = await compressImage(imagePath, tmpDir);
      tmpFiles.push(compressed);
      imagePath = compressed;
      process.stdout.write(` ${(fs.statSync(imagePath).size / 1024 / 1024).toFixed(1)}MB ✓\n`);
    } catch (e) {
      process.stdout.write(`\n⚠️  压缩失败，继续使用当前图片\n`);
    }
  }

  const imageBase64 = fs.readFileSync(imagePath, 'base64');
  const mimeType = detectMimeType(imagePath);

  // 构建 prompt
  const textPart = [
    TITLE    ? `主标题：${TITLE}` : '',
    SUBTITLE ? `副标题：${SUBTITLE}` : '',
  ].filter(Boolean).join('\n');

  const fullPrompt = `${style.prompt}\n\n【文字内容 - 使用以下文字】\n${textPart}${EXTRA ? '\n\n【额外要求】\n' + EXTRA : ''}`;

  // 准备输出目录
  const resolvedOutputDir = expandHome(OUTPUT_DIR);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  console.log(`\n🎨 风格：${style.name} (${STYLE_ID})`);
  console.log(`📝 主标题：${TITLE}${SUBTITLE ? ' / 副标题：' + SUBTITLE : ''}`);
  console.log(`📐 比例：${RATIO}  |  数量：${COUNT} 张  |  重试上限：${MAX_RETRIES}`);
  console.log(`🔑 API：${API_ENDPOINT || BASE_URL} / ${MODEL}`);
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
        aspectRatio: RATIO,
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const ext = result.mimeType.includes('png') ? 'png' : 'jpg';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `cover_${style.name}_${timestamp}_${i}.${ext}`;
      const outputPath = path.join(resolvedOutputDir, fileName);

      fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
      process.stdout.write(`\r✅ 已生成${label}（${elapsed}s）: ${outputPath}\n`);
      successCount++;

      // 自动打开图片（macOS: open, Linux: xdg-open）
      if (COUNT === 1) {
        try {
          const opener = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
          if (opener) {
            const { execSync } = await import('child_process');
            execSync(`${opener} "${outputPath}"`, { stdio: 'ignore' });
          }
        } catch {}
      }
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r❌ 生成失败${label}（${elapsed}s）: ${err.message}\n`);
    }
  }

  // 清理临时文件
  for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }

  console.log(`\n完成：${successCount}/${COUNT} 张成功，保存在 ${resolvedOutputDir}`);
  if (successCount === 0) process.exit(5);
}

main().catch(err => {
  console.error('❌ 未知错误:', err.message);
  process.exit(1);
});
