"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const {
  HERO_HEIGHT,
  HERO_WIDTH,
  MAX_IMAGE_BYTES,
  assertArticleInput,
} = require("./articleCore.cjs");

const LOGO_PATH = path.join(process.cwd(), "public/logo/logo-horizontal.svg");
const FONT_PATH = path.join(
  process.cwd(),
  "lib/seoArticles/assets/NotoSans-Regular.ttf",
);
const FONT_CANDIDATES = [
  FONT_PATH,
  path.join(__dirname, "assets/NotoSans-Regular.ttf"),
];
const VOICE = require("../../marketing/brand/voice.json");
const POSITIONING = require("../../marketing/brand/positioning.json");

const MOBILE_WIDTH = 390;
const MIN_TITLE_FONT_SIZE = 66;
const MAX_TITLE_LINES = 3;
const SAFE_MARGIN = { top: 55, right: 80, bottom: 55, left: 80 };
const LAYOUT_VARIANTS = {
  standard: {
    titleFontSize: 76,
    titleLineHeight: 86,
    titleMaxLines: 3,
    titleArea: { x: 120, y: 292, width: 820, height: 260 },
    description: true,
    descriptionWidth: 820,
    illustration: { x: 1080, y: 245, width: 380, height: 280 },
    guaranteedSafe: false,
  },
  alternative: {
    titleFontSize: 72,
    titleLineHeight: 82,
    titleMaxLines: 3,
    titleArea: { x: 120, y: 300, width: 980, height: 250 },
    description: false,
    descriptionWidth: 0,
    illustration: { x: 1250, y: 285, width: 230, height: 220 },
    guaranteedSafe: false,
  },
  minimal: {
    titleFontSize: 104,
    titleLineHeight: 120,
    titleMaxLines: 2,
    titleArea: { x: 100, y: 255, width: 1400, height: 270 },
    description: false,
    descriptionWidth: 0,
    illustration: null,
    guaranteedSafe: true,
  },
};

const BRAND = {
  ink: "#143c3a",
  green: "#37c48e",
  mint: "#dff7ed",
  paper: "#fbf7ef",
  white: "#ffffff",
  muted: "#59625d",
};

function escapeXml(value) {
  return String(value ?? "").replace(
    /[<>&'"]/g,
    (character) => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    })[character],
  );
}

function characterWidth(character, fontSize) {
  if (character === " ") return fontSize * 0.28;
  if (/[MW@%&]/.test(character)) return fontSize * 0.78;
  if (/[A-Z0-9]/.test(character)) return fontSize * 0.62;
  if (/[ilI.,'’!:;]/.test(character)) return fontSize * 0.27;
  return fontSize * 0.52;
}

function measureTextWidth(value, fontSize, { fontWeight = 400 } = {}) {
  const weightFactor = Number(fontWeight) >= 700 ? 1.035 : 1;
  return [...String(value || "")]
    .reduce((width, character) => width + characterWidth(character, fontSize), 0)
    * weightFactor;
}

function wrapTextToWidth(value, {
  maxWidth,
  fontSize,
  fontWeight = 400,
  maxLines,
}) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  let unbreakableWord = null;
  for (const word of words) {
    if (measureTextWidth(word, fontSize, { fontWeight }) > maxWidth) {
      unbreakableWord = word;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measureTextWidth(candidate, fontSize, { fontWeight }) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return {
    lines,
    fits: !unbreakableWord && lines.length <= maxLines,
    unbreakableWord,
  };
}

function wrapTitle(title, maxCharacters = 34, maxLines = MAX_TITLE_LINES) {
  const approximateWidth = maxCharacters * 76 * 0.52;
  return wrapTextToWidth(title, {
    maxWidth: approximateWidth,
    fontSize: 76,
    fontWeight: 800,
    maxLines,
  }).lines.slice(0, maxLines);
}

function box(x, y, width, height) {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function boxesIntersect(first, second) {
  if (!first || !second) return false;
  return first.x < second.right
    && first.right > second.x
    && first.y < second.bottom
    && first.bottom > second.y;
}

function resolveRenderFont(fontPath) {
  const candidates = fontPath ? [fontPath] : FONT_CANDIDATES;
  const resolvedPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (resolvedPath) {
    return {
      requestedFamily: "Noto Sans",
      resolvedFamily: "Noto Sans (embedded server asset)",
      font: "Noto Sans",
      fontfile: resolvedPath,
      fallbackUsed: false,
    };
  }
  return {
    requestedFamily: "Noto Sans",
    resolvedFamily: "Pango sans-serif fallback",
    font: "sans-serif",
    fontfile: undefined,
    fallbackUsed: true,
  };
}

async function renderLine(text, {
  font,
  fontSize,
  colour,
  bold,
}) {
  const markup = `<span foreground="${colour}"${bold ? ' weight="bold"' : ""}>${escapeXml(text)}</span>`;
  const input = {
    text: markup,
    font: `${font.font} ${fontSize}`,
    rgba: true,
    dpi: 72,
    ...(font.fontfile ? { fontfile: font.fontfile } : {}),
  };
  return sharp({ text: input }).png().toBuffer({ resolveWithObject: true });
}

async function measureRenderedLine(text, options) {
  const rendered = await renderLine(text, options);
  return {
    width: rendered.info.width,
    height: rendered.info.height,
  };
}

async function wrapWithRenderer(value, {
  maxWidth,
  maxLines,
  font,
  fontSize,
  colour,
  bold = false,
}) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  const metrics = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    const measured = await measureRenderedLine(candidate, {
      font,
      fontSize,
      colour,
      bold,
    });
    if (!line || measured.width <= maxWidth) {
      line = candidate;
    } else {
      const lineMetric = await measureRenderedLine(line, {
        font,
        fontSize,
        colour,
        bold,
      });
      lines.push(line);
      metrics.push(lineMetric);
      line = word;
    }
  }
  if (line) {
    lines.push(line);
    metrics.push(await measureRenderedLine(line, {
      font,
      fontSize,
      colour,
      bold,
    }));
  }
  return {
    lines,
    metrics,
    fits: lines.length <= maxLines && metrics.every((metric) => metric.width <= maxWidth),
  };
}

async function createTextRaster(value, {
  area,
  maxLines,
  font,
  fontSize,
  lineHeight,
  colour,
  bold = false,
}) {
  const wrapped = await wrapWithRenderer(value, {
    maxWidth: area.width - 16,
    maxLines,
    font,
    fontSize,
    colour,
    bold,
  });
  const padding = 8;
  const lineRenders = await Promise.all(wrapped.lines.map((line) => renderLine(line, {
    font,
    fontSize,
    colour,
    bold,
  })));
  const contentWidth = Math.max(0, ...lineRenders.map((line) => line.info.width));
  const contentHeight = lineRenders.length
    ? (lineRenders.length - 1) * lineHeight
      + Math.max(...lineRenders.map((line) => line.info.height))
    : 0;
  const width = Math.max(1, contentWidth + padding * 2);
  const height = Math.max(1, contentHeight + padding * 2);
  const composites = lineRenders.map((line, index) => ({
    input: line.data,
    left: padding,
    top: padding + index * lineHeight,
  }));
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toBuffer();
  const bounds = box(
    area.x + padding,
    area.y + padding,
    contentWidth,
    contentHeight,
  );
  return {
    buffer,
    width,
    height,
    padding,
    lines: wrapped.lines,
    lineMetrics: wrapped.metrics,
    fits: wrapped.fits
      && width <= area.width
      && height <= area.height,
    bounds,
  };
}

function buildHeroLayout(article, {
  heroTitle,
  layoutVariant = "standard",
  overrides = {},
} = {}) {
  assertArticleInput(article);
  const variant = LAYOUT_VARIANTS[layoutVariant];
  if (!variant) throw new Error(`Unknown native hero layout variant: ${layoutVariant}.`);
  const settings = {
    ...variant,
    ...overrides,
    titleArea: { ...variant.titleArea, ...(overrides.titleArea || {}) },
  };
  const displayTitle = String(heroTitle || article.heroTitle || article.title).trim();
  const titleWrap = wrapTextToWidth(displayTitle, {
    maxWidth: settings.titleArea.width,
    fontSize: settings.titleFontSize,
    fontWeight: 800,
    maxLines: settings.titleMaxLines,
  });
  const titleWidth = Math.max(
    0,
    ...titleWrap.lines.map((line) => measureTextWidth(line, settings.titleFontSize, {
      fontWeight: 800,
    })),
  );
  const titleHeight = titleWrap.lines.length
    ? settings.titleFontSize + (titleWrap.lines.length - 1) * settings.titleLineHeight
    : 0;
  const title = box(settings.titleArea.x, settings.titleArea.y, titleWidth, titleHeight);
  const descriptionTop = title.bottom + 25;
  const descriptionWrap = settings.description
    ? wrapTextToWidth(String(article.description).slice(0, 180), {
      maxWidth: settings.descriptionWidth,
      fontSize: 30,
      maxLines: 3,
    })
    : { lines: [], fits: true };
  const descriptionWidth = Math.max(
    0,
    ...descriptionWrap.lines.map((line) => measureTextWidth(line, 30)),
  );
  const descriptionHeight = descriptionWrap.lines.length
    ? 30 + (descriptionWrap.lines.length - 1) * 39
    : 0;
  const illustration = settings.illustration
    ? { ...settings.illustration, ...(overrides.illustration || {}) }
    : null;
  const minimal = settings.guaranteedSafe;
  const boxes = {
    logo: minimal ? box(100, 785, 190, 48) : box(120, 68, 300, 90),
    title,
    description: settings.description
      ? box(120, descriptionTop, descriptionWidth, descriptionHeight)
      : null,
    footer: minimal ? box(1240, 790, 260, 35) : box(120, 790, 1360, 40),
    illustration: illustration
      ? box(illustration.x, illustration.y, illustration.width, illustration.height)
      : null,
  };
  return {
    width: HERO_WIDTH,
    height: HERO_HEIGHT,
    safeMargin: minimal
      ? { top: 80, right: 100, bottom: 55, left: 100 }
      : SAFE_MARGIN,
    layoutVariant,
    displayTitle,
    titleFontSize: settings.titleFontSize,
    titleLineHeight: settings.titleLineHeight,
    titleMaxLines: settings.titleMaxLines,
    titleArea: box(
      settings.titleArea.x,
      settings.titleArea.y,
      settings.titleArea.width,
      settings.titleArea.height,
    ),
    descriptionEnabled: settings.description,
    descriptionFontSize: 30,
    descriptionLineHeight: 39,
    titleLines: titleWrap.lines,
    titleFits: titleWrap.fits,
    descriptionLines: descriptionWrap.lines,
    descriptionFits: descriptionWrap.fits,
    guaranteedSafe: settings.guaranteedSafe,
    boxes,
  };
}

function contrastRatio(first, second) {
  function luminance(hex) {
    const values = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255);
    const linear = values.map((value) => (
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

function validateHeroLayout(layout) {
  const issues = [];
  if (layout.titleLines.length > layout.titleMaxLines || !layout.titleFits) {
    issues.push({
      code: "title-too-many-lines",
      severity: "critical",
      message: `Hero title cannot fit within ${layout.titleMaxLines} lines.`,
    });
  }
  if (layout.titleFontSize < MIN_TITLE_FONT_SIZE) {
    issues.push({
      code: "title-font-too-small",
      severity: "critical",
      message: `Hero title font size must be at least ${MIN_TITLE_FONT_SIZE}px.`,
    });
  }
  if (!layout.descriptionFits) {
    issues.push({
      code: "description-too-tall",
      severity: "critical",
      message: "Hero description cannot fit within three lines.",
    });
  }
  const { top, right, bottom, left } = layout.safeMargin;
  for (const [name, bounds] of Object.entries(layout.boxes)) {
    if (!bounds) continue;
    if (
      bounds.x < left
      || bounds.y < top
      || bounds.right > layout.width - right
      || bounds.bottom > layout.height - bottom
    ) {
      issues.push({
        code: `${name}-outside-safe-area`,
        severity: "critical",
        message: `${name} is clipped, off-canvas, or outside the safe margins.`,
      });
    }
  }
  if (
    layout.boxes.title.x < layout.titleArea.x
    || layout.boxes.title.y < layout.titleArea.y
    || layout.boxes.title.right > layout.titleArea.right
    || layout.boxes.title.bottom > layout.titleArea.bottom
  ) {
    issues.push({
      code: "title-outside-title-area",
      severity: "critical",
      message: "Rendered title bounds exceed the safe title region.",
    });
  }
  const names = ["title", "description", "logo", "footer", "illustration"];
  for (let firstIndex = 0; firstIndex < names.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < names.length; secondIndex += 1) {
      const firstName = names[firstIndex];
      const secondName = names[secondIndex];
      if (boxesIntersect(layout.boxes[firstName], layout.boxes[secondName])) {
        issues.push({
          code: `${firstName}-${secondName}-intersection`,
          severity: "critical",
          message: `${firstName} intersects ${secondName}.`,
        });
      }
    }
  }
  const mobileScale = MOBILE_WIDTH / layout.width;
  if (layout.titleFontSize * mobileScale < 16) {
    issues.push({
      code: "mobile-title-too-small",
      severity: "critical",
      message: "The downscaled hero title is below 16px on the mobile preview.",
    });
  }
  const titleBackground = layout.guaranteedSafe ? BRAND.white : BRAND.paper;
  const titleContrast = contrastRatio(BRAND.ink, titleBackground);
  if (titleContrast < 4.5) {
    issues.push({
      code: "title-contrast-failed",
      severity: "critical",
      message: "Title contrast is below WCAG AA.",
    });
  }
  return {
    passed: issues.length === 0,
    issues,
    boundingBoxes: layout.boxes,
    titleAreaBoundingBox: layout.titleArea,
    titleLineCount: layout.titleLines.length,
    mobileScale,
    mobileTitleFontSize: layout.titleFontSize * mobileScale,
    titleContrast,
  };
}

function embeddedLogo() {
  const logo = fs.readFileSync(LOGO_PATH);
  return `data:image/svg+xml;base64,${logo.toString("base64")}`;
}

function loadBrandSettings() {
  return {
    voice: VOICE,
    positioning: POSITIONING,
    palette: BRAND,
    typography: {
      heading: "Noto Sans",
      body: "Noto Sans",
    },
  };
}

function renderIllustration(bounds, brand) {
  if (!bounds) return "";
  const cardX = bounds.x + bounds.width * 0.08;
  const cardY = bounds.y + bounds.height * 0.15;
  const cardWidth = bounds.width * 0.84;
  const cardHeight = bounds.height * 0.7;
  return `<g data-layout-element="illustration">
    <circle cx="${bounds.x + bounds.width * 0.7}" cy="${bounds.y + bounds.height * 0.3}" r="${bounds.width * 0.27}" fill="${brand.palette.mint}"/>
    <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="28" fill="${brand.palette.white}" stroke="${brand.palette.ink}" stroke-width="4"/>
    <rect x="${cardX + cardWidth * 0.14}" y="${cardY + cardHeight * 0.28}" width="${cardWidth * 0.7}" height="16" rx="8" fill="${brand.palette.green}"/>
    <rect x="${cardX + cardWidth * 0.14}" y="${cardY + cardHeight * 0.52}" width="${cardWidth * 0.5}" height="13" rx="7" fill="${brand.palette.ink}" opacity="0.3"/>
    <rect x="${cardX + cardWidth * 0.14}" y="${cardY + cardHeight * 0.7}" width="${cardWidth * 0.62}" height="13" rx="7" fill="${brand.palette.ink}" opacity="0.18"/>
  </g>`;
}

async function resolveRenderedLayout(article, options = {}) {
  const brand = options.brand || loadBrandSettings();
  const font = resolveRenderFont();
  const layout = buildHeroLayout(article, options);
  const titleRaster = await createTextRaster(layout.displayTitle, {
    area: layout.titleArea,
    maxLines: layout.titleMaxLines,
    font,
    fontSize: layout.titleFontSize,
    lineHeight: layout.titleLineHeight,
    colour: brand.palette.ink,
    bold: true,
  });
  layout.titleLines = titleRaster.lines;
  layout.titleFits = titleRaster.fits;
  layout.boxes.title = titleRaster.bounds;
  let descriptionRaster = null;
  if (layout.descriptionEnabled) {
    const descriptionArea = box(
      120,
      titleRaster.bounds.bottom + 24,
      820,
      Math.max(1, 720 - (titleRaster.bounds.bottom + 24)),
    );
    descriptionRaster = await createTextRaster(String(article.description).slice(0, 180), {
      area: descriptionArea,
      maxLines: 3,
      font,
      fontSize: layout.descriptionFontSize,
      lineHeight: layout.descriptionLineHeight,
      colour: brand.palette.muted,
    });
    layout.descriptionLines = descriptionRaster.lines;
    layout.descriptionFits = descriptionRaster.fits;
    layout.boxes.description = descriptionRaster.bounds;
    layout.descriptionArea = descriptionArea;
  }
  return {
    brand,
    font,
    layout,
    titleRaster,
    descriptionRaster,
  };
}

function renderNativeHeroSvg(article, {
  brand,
  font,
  layout,
  titleRaster,
  descriptionRaster,
}) {
  const validation = validateHeroLayout(layout);
  if (!validation.passed) {
    const error = new Error(`Native hero layout failed: ${validation.issues.map((issue) => issue.code).join(", ")}.`);
    error.code = "seo/hero-layout-failed";
    error.layoutIssues = validation.issues;
    error.renderDiagnostics = {
      attemptedHeroTitle: layout.displayTitle,
      fontFamily: font.requestedFamily,
      resolvedFontFamily: font.resolvedFamily,
      fontSize: layout.titleFontSize,
      lineHeight: layout.titleLineHeight,
      calculatedTextBoundingBox: layout.boxes.title,
      titleAreaBoundingBox: layout.titleArea,
      renderedSvgDimensions: { width: HERO_WIDTH, height: HERO_HEIGHT },
      layoutVariant: layout.layoutVariant,
      deterministicIssues: validation.issues,
    };
    throw error;
  }
  const category = escapeXml(String(article.category).replaceAll("-", " ").toUpperCase());
  const qualifier = escapeXml(
    brand.positioning?.requiredQualifier
      || "Estimates based on the figures entered by the user.",
  );
  const minimal = layout.guaranteedSafe;
  const logo = layout.boxes.logo;
  return {
    validation,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${HERO_WIDTH}" height="${HERO_HEIGHT}" viewBox="0 0 ${HERO_WIDTH} ${HERO_HEIGHT}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(layout.displayTitle)}</title>
  <desc id="description">${escapeXml(article.description)}</desc>
  <rect width="${HERO_WIDTH}" height="${HERO_HEIGHT}" fill="${minimal ? brand.palette.white : brand.palette.paper}"/>
  ${minimal ? "" : renderIllustration(layout.boxes.illustration, brand)}
  ${minimal ? "" : `<image data-layout-element="logo" href="${embeddedLogo()}" x="${logo.x}" y="${logo.y}" width="${logo.width}" height="${logo.height}" preserveAspectRatio="xMinYMid meet"/>
  <rect x="120" y="210" width="86" height="8" rx="4" fill="${brand.palette.green}"/>
  <text x="120" y="267" fill="${brand.palette.muted}" font-family="sans-serif" font-size="24" font-weight="700" letter-spacing="3">${category}</text>`}
  <image data-layout-element="title" href="data:image/png;base64,${titleRaster.buffer.toString("base64")}" x="${layout.titleArea.x}" y="${layout.titleArea.y}" width="${titleRaster.width}" height="${titleRaster.height}"/>
  ${descriptionRaster ? `<image data-layout-element="description" href="data:image/png;base64,${descriptionRaster.buffer.toString("base64")}" x="${layout.descriptionArea.x}" y="${layout.descriptionArea.y}" width="${descriptionRaster.width}" height="${descriptionRaster.height}"/>` : ""}
  <g data-layout-element="footer">
    <rect x="${minimal ? 80 : 120}" y="760" width="${minimal ? 1440 : 1360}" height="1" fill="${brand.palette.ink}" opacity="0.18"/>
    ${minimal ? `<image data-layout-element="logo" href="${embeddedLogo()}" x="${logo.x}" y="${logo.y}" width="${logo.width}" height="${logo.height}" preserveAspectRatio="xMinYMid meet"/>` : `<text x="120" y="822" fill="${brand.palette.ink}" font-family="sans-serif" font-size="22" font-weight="600">${qualifier}</text>`}
    <text x="1480" y="822" text-anchor="end" fill="${brand.palette.ink}" font-family="sans-serif" font-size="22" font-weight="800">ClearTill Journal</text>
  </g>
</svg>`,
  };
}

async function renderResponsiveMobileHero(article, {
  brand,
  font,
  layout,
}) {
  const titleArea = box(20, 38, 350, 108);
  const fontSize = 32;
  const lineHeight = 39;
  const titleRaster = await createTextRaster(layout.displayTitle, {
    area: titleArea,
    maxLines: 2,
    font,
    fontSize,
    lineHeight,
    colour: brand.palette.ink,
    bold: true,
  });
  if (!titleRaster.fits || titleRaster.lines.length > 2) {
    const issue = {
      code: "responsive-mobile-title-does-not-fit",
      severity: "critical",
      message: "The guaranteed-safe mobile title cannot fit in two lines.",
    };
    const error = new Error(issue.message);
    error.code = "seo/hero-layout-failed";
    error.layoutIssues = [issue];
    error.renderDiagnostics = {
      attemptedHeroTitle: layout.displayTitle,
      fontFamily: font.requestedFamily,
      resolvedFontFamily: font.resolvedFamily,
      fontSize: layout.titleFontSize,
      mobileTitleFontSize: fontSize,
      lineHeight,
      calculatedTextBoundingBox: layout.boxes.title,
      mobileTextBoundingBox: titleRaster.bounds,
      titleAreaBoundingBox: layout.titleArea,
      mobileTitleAreaBoundingBox: titleArea,
      renderedSvgDimensions: { width: HERO_WIDTH, height: HERO_HEIGHT },
      mobileSvgDimensions: {
        width: MOBILE_WIDTH,
        height: Math.round((HERO_HEIGHT / HERO_WIDTH) * MOBILE_WIDTH),
      },
      layoutVariant: layout.layoutVariant,
      deterministicIssues: [issue],
    };
    throw error;
  }
  const mobileHeight = Math.round((HERO_HEIGHT / HERO_WIDTH) * MOBILE_WIDTH);
  const logo = embeddedLogo();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${MOBILE_WIDTH}" height="${mobileHeight}" viewBox="0 0 ${MOBILE_WIDTH} ${mobileHeight}" role="img" aria-labelledby="mobile-title mobile-description">
  <title id="mobile-title">${escapeXml(layout.displayTitle)}</title>
  <desc id="mobile-description">${escapeXml(article.description)}</desc>
  <rect width="${MOBILE_WIDTH}" height="${mobileHeight}" fill="${brand.palette.white}"/>
  <image data-layout-element="title" href="data:image/png;base64,${titleRaster.buffer.toString("base64")}" x="${titleArea.x}" y="${titleArea.y}" width="${titleRaster.width}" height="${titleRaster.height}"/>
  <g data-layout-element="footer">
    <rect x="20" y="174" width="350" height="1" fill="${brand.palette.ink}" opacity="0.18"/>
    <image data-layout-element="logo" href="${logo}" x="20" y="184" width="92" height="26" preserveAspectRatio="xMinYMid meet"/>
    <text x="370" y="202" text-anchor="end" fill="${brand.palette.ink}" font-family="sans-serif" font-size="11" font-weight="800">ClearTill Journal</text>
  </g>
</svg>`;
  return {
    fontSize,
    lineHeight,
    png: await sharp(Buffer.from(svg)).png({
      compressionLevel: 9,
      palette: true,
    }).toBuffer(),
    svg,
    titleArea,
    titleRaster,
  };
}

async function countInkPixels(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  let count = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    if (alpha > 30 && red < 100 && green < 125 && blue < 125) count += 1;
  }
  return count;
}

async function countAlphaPixels(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  let count = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] > 30) count += 1;
  }
  return count;
}

async function validatePostRender({
  svg,
  png,
  mobilePng,
  layout,
  titleRaster,
  mobileTitleBox,
  mobileTitleRaster,
}) {
  const issues = [];
  const [masterMetadata, mobileMetadata] = await Promise.all([
    sharp(png).metadata(),
    sharp(mobilePng).metadata(),
  ]);
  if (masterMetadata.width !== HERO_WIDTH || masterMetadata.height !== HERO_HEIGHT) {
    issues.push({
      code: "master-dimensions-mismatch",
      severity: "critical",
      message: "Rendered master PNG dimensions do not match 1600×900.",
    });
  }
  const expectedMobileHeight = Math.round((HERO_HEIGHT / HERO_WIDTH) * MOBILE_WIDTH);
  if (mobileMetadata.width !== MOBILE_WIDTH || mobileMetadata.height !== expectedMobileHeight) {
    issues.push({
      code: "mobile-dimensions-mismatch",
      severity: "critical",
      message: "Rendered mobile PNG dimensions do not match the expected downscale.",
    });
  }
  issues.push(...validateSvgStructure(svg).issues);
  const titleBox = layout.boxes.title;
  const masterCrop = await sharp(png).extract({
    left: Math.floor(titleBox.x),
    top: Math.floor(titleBox.y),
    width: Math.max(1, Math.ceil(titleBox.width)),
    height: Math.max(1, Math.ceil(titleBox.height)),
  }).png().toBuffer();
  const expectedTitlePixels = await countAlphaPixels(titleRaster.buffer);
  const masterTitlePixels = await countInkPixels(masterCrop);
  if (expectedTitlePixels === 0 || masterTitlePixels < expectedTitlePixels * 0.7) {
    issues.push({
      code: "master-title-pixels-missing",
      severity: "critical",
      message: "Rasterised master is missing or obscuring title pixels.",
    });
  }
  const scale = MOBILE_WIDTH / HERO_WIDTH;
  const responsiveTitleBox = mobileTitleBox || {
    x: titleBox.x * scale,
    y: titleBox.y * scale,
    width: titleBox.width * scale,
    height: titleBox.height * scale,
  };
  const mobileBox = {
    left: Math.max(0, Math.floor(responsiveTitleBox.x)),
    top: Math.max(0, Math.floor(responsiveTitleBox.y)),
    width: Math.max(1, Math.min(
      MOBILE_WIDTH - Math.floor(responsiveTitleBox.x),
      Math.ceil(responsiveTitleBox.width),
    )),
    height: Math.max(1, Math.min(
      expectedMobileHeight - Math.floor(responsiveTitleBox.y),
      Math.ceil(responsiveTitleBox.height),
    )),
  };
  const mobileCrop = await sharp(mobilePng).extract(mobileBox).png().toBuffer();
  const mobileTitlePixels = await countInkPixels(mobileCrop);
  const expectedMobileTitlePixels = mobileTitleRaster
    ? await countAlphaPixels(mobileTitleRaster.buffer)
    : expectedTitlePixels * scale * scale;
  const mobilePixelThreshold = mobileTitleRaster ? 0.7 : 0.35;
  if (mobileTitlePixels < expectedMobileTitlePixels * mobilePixelThreshold) {
    issues.push({
      code: "mobile-title-pixels-missing",
      severity: "critical",
      message: "Rasterised mobile preview is missing or obscuring title pixels.",
    });
  }
  return {
    passed: issues.length === 0,
    issues,
    masterDimensions: { width: masterMetadata.width, height: masterMetadata.height },
    mobileDimensions: { width: mobileMetadata.width, height: mobileMetadata.height },
    titlePixelCounts: {
      expected: expectedTitlePixels,
      master: masterTitlePixels,
      mobile: mobileTitlePixels,
      expectedMobile: expectedMobileTitlePixels,
    },
    clipPathDetected: /<(?:clipPath|mask)\b/i.test(svg),
  };
}

function validateSvgStructure(svg) {
  const issues = [];
  if (!String(svg).includes(`viewBox="0 0 ${HERO_WIDTH} ${HERO_HEIGHT}"`)) {
    issues.push({
      code: "svg-viewbox-mismatch",
      severity: "critical",
      message: "SVG viewBox does not match the output canvas.",
    });
  }
  if (/<(?:clipPath|mask)\b/i.test(String(svg))) {
    issues.push({
      code: "title-clipping-structure-detected",
      severity: "critical",
      message: "SVG contains a clip path or mask that could obscure the title.",
    });
  }
  return { passed: issues.length === 0, issues };
}

async function generateNativeHero(article, options = {}) {
  assertArticleInput(article);
  const prepared = await resolveRenderedLayout(article, options);
  const rendered = renderNativeHeroSvg(article, prepared);
  const png = await sharp(Buffer.from(rendered.svg))
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  if (png.length > MAX_IMAGE_BYTES) {
    throw new Error(`Native hero exceeds the ${MAX_IMAGE_BYTES}-byte publication limit.`);
  }
  const responsiveMobile = prepared.layout.guaranteedSafe
    ? await renderResponsiveMobileHero(article, prepared)
    : null;
  const mobilePng = responsiveMobile?.png || await sharp(png)
    .resize({ width: MOBILE_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  const postRender = await validatePostRender({
    svg: rendered.svg,
    png,
    mobilePng,
    layout: prepared.layout,
    titleRaster: prepared.titleRaster,
    mobileTitleBox: responsiveMobile?.titleRaster?.bounds,
    mobileTitleRaster: responsiveMobile?.titleRaster,
  });
  const mobileTitleFontSize = responsiveMobile?.fontSize
    || rendered.validation.mobileTitleFontSize;
  const diagnostics = {
    attemptedHeroTitle: prepared.layout.displayTitle,
    fontFamily: prepared.font.requestedFamily,
    resolvedFontFamily: prepared.font.resolvedFamily,
    fontFallbackUsed: prepared.font.fallbackUsed,
    fontSize: prepared.layout.titleFontSize,
    mobileTitleFontSize,
    lineHeight: prepared.layout.titleLineHeight,
    calculatedTextBoundingBox: prepared.layout.boxes.title,
    titleAreaBoundingBox: prepared.layout.titleArea,
    renderedSvgDimensions: { width: HERO_WIDTH, height: HERO_HEIGHT },
    renderedPngDimensions: postRender.masterDimensions,
    mobilePngDimensions: postRender.mobileDimensions,
    layoutVariant: prepared.layout.layoutVariant,
    titleContrast: rendered.validation.titleContrast,
    titleForeground: prepared.brand.palette.ink,
    titleBackground: prepared.layout.guaranteedSafe
      ? prepared.brand.palette.white
      : prepared.brand.palette.paper,
    deterministicIssues: [
      ...rendered.validation.issues,
      ...postRender.issues,
    ],
    postRender,
  };
  if (!postRender.passed) {
    const error = new Error(`Post-render hero validation failed: ${postRender.issues.map((issue) => issue.code).join(", ")}.`);
    error.code = "seo/hero-post-render-failed";
    error.layoutIssues = postRender.issues;
    error.renderDiagnostics = diagnostics;
    throw error;
  }
  return {
    source: "cleartill_native",
    width: HERO_WIDTH,
    height: HERO_HEIGHT,
    mobileWidth: MOBILE_WIDTH,
    mobileHeight: Math.round((HERO_HEIGHT / HERO_WIDTH) * MOBILE_WIDTH),
    svg: rendered.svg,
    png,
    mobilePng,
    mediaType: "image/png",
    filename: `${article.slug}-hero.png`,
    mobileFilename: `${article.slug}-hero-mobile.png`,
    alt: options.altText || article.heroImage?.alt || article.description,
    heroTitle: prepared.layout.displayTitle,
    layoutVariant: prepared.layout.layoutVariant,
    layoutValidation: {
      ...rendered.validation,
      mobileTitleFontSize,
      postRender,
      passed: rendered.validation.passed && postRender.passed,
    },
    diagnostics,
    brand: loadBrandSettings(),
  };
}

module.exports = {
  BRAND,
  FONT_PATH,
  LAYOUT_VARIANTS,
  MAX_TITLE_LINES,
  MIN_TITLE_FONT_SIZE,
  MOBILE_WIDTH,
  buildHeroLayout,
  createTextRaster,
  generateNativeHero,
  loadBrandSettings,
  measureRenderedLine,
  measureTextWidth,
  renderNativeHeroSvg,
  resolveRenderFont,
  resolveRenderedLayout,
  validateHeroLayout,
  validatePostRender,
  validateSvgStructure,
  wrapTextToWidth,
  wrapTitle,
};
