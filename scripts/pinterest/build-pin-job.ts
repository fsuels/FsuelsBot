import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

type Rule = {
  board: string;
  priority: number;
  any?: string[];
  all?: string[];
  none?: string[];
};

type BoardRoutingConfig = {
  version: string;
  safePublishBoards: Array<{ name: string; status: string; notes?: string }>;
  legacyBoards?: Array<{ name: string; status: string; notes?: string }>;
  rules: Rule[];
  plannedBoards?: string[];
};

type QueueFrontmatter = {
  title?: string;
  source?: string;
  product_url?: string;
  board_hint?: string;
  language?: string;
  priority?: string;
  campaign?: string;
  notes?: string;
  status?: string;
};

type JobPacket = {
  jobId: string;
  generatedAt: string;
  queueNotePath: string;
  queueNoteName: string;
  productTitle: string;
  sourceUrl: string;
  mainImageUrl: string | null;
  mainImageAlt: string | null;
  mainImageSource: "product-page-first-gallery-image" | "queue-note-fallback";
  language: string;
  board: string | null;
  boardConfidence: "high" | "medium" | "low";
  boardReason: string;
  needsReview: boolean;
  reviewReason: string | null;
  pinSpec: {
    width: number;
    height: number;
    aspectRatio: string;
  };
  draft: {
    title: string;
    description: string;
    altText: string;
    destinationUrl: string;
    hashtags: string[];
    productTagSearchTerms: string[];
  };
  fieldsUsed: {
    boardHint: string | null;
    priority: string | null;
    campaign: string | null;
    notes: string | null;
  };
};

const ROOT = process.cwd();
const DEFAULT_CONFIG = path.join(ROOT, "workspace/pinterest/config/board-routing.json");
const DEFAULT_TEMPLATE = path.join(ROOT, "workspace/pinterest/templates/publish-agent-template.md");
const DEFAULT_JOB_ROOT = path.join(ROOT, "workspace/pinterest-jobs");

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(current, "true");
      continue;
    }
    args.set(current, next);
    index += 1;
  }
  return {
    queueNote: args.get("--queue-note"),
    configPath: args.get("--config") ?? DEFAULT_CONFIG,
    templatePath: args.get("--template") ?? DEFAULT_TEMPLATE,
    jobRoot: args.get("--job-root") ?? DEFAULT_JOB_ROOT
  };
}

function splitFrontmatter(input: string): { frontmatter: QueueFrontmatter; body: string } {
  if (!input.startsWith("---\n")) {
    return { frontmatter: {}, body: input };
  }
  const end = input.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, body: input };
  }
  const raw = input.slice(4, end);
  const body = input.slice(end + 5);
  const parsed = YAML.parse(raw) as QueueFrontmatter | null;
  return { frontmatter: parsed ?? {}, body };
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractHeading(body: string): string | null {
  const match = body.match(/^##\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function extractMainImage(body: string): string | null {
  const match = body.match(/!\[[^\]]*]\((https?:\/\/[^)]+)\)/i);
  return match?.[1] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeImageUrl(value: string): string {
  return decodeHtmlEntities(value.trim()).replace(/^\/\//, "https://");
}

async function fetchLiveProductPageImage(sourceUrl: string): Promise<{
  url: string | null;
  alt: string | null;
}> {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return { url: null, alt: null };
    }
    const html = await response.text();
    const match = html.match(/product__media-item[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]*)"/i);
    if (!match) {
      return { url: null, alt: null };
    }
    return {
      url: normalizeImageUrl(match[1]),
      alt: decodeHtmlEntities(match[2])
    };
  } catch {
    return { url: null, alt: null };
  }
}

function extractSourceUrl(frontmatter: QueueFrontmatter, body: string): string | null {
  if (frontmatter.product_url) {
    return frontmatter.product_url.trim();
  }
  if (frontmatter.source) {
    return frontmatter.source.trim();
  }
  const markdownLink = body.match(/\[View full details]\((https?:\/\/[^)]+)\)/i);
  if (markdownLink?.[1]) {
    return markdownLink[1];
  }
  const rawUrl = body.match(/https?:\/\/\S+/i);
  return rawUrl?.[0] ?? null;
}

function buildDestinationUrl(sourceUrl: string, campaignSeed: string): string {
  const url = new URL(sourceUrl);
  url.searchParams.set("utm_source", "pinterest");
  url.searchParams.set("utm_medium", "organic");
  if (!url.searchParams.has("utm_campaign")) {
    url.searchParams.set("utm_campaign", slugify(campaignSeed) || "dresslikemommy-pinterest");
  }
  return url.toString();
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeQuotes(value: string): string {
  return value.replace(/[’]/g, "'").replace(/[–]/g, "-");
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function truncateTo(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength - 3).trimEnd() + "...";
}

function inferProductSignals(productTitle: string, sourceUrl: string) {
  const lower = normalizeQuotes(`${productTitle} ${sourceUrl}`).toLowerCase();
  return {
    lower,
    hasHawaiian: hasAny(lower, ["hawaiian", "tropical"]),
    hasFloral: lower.includes("floral"),
    hasPaisley: lower.includes("paisley"),
    hasPalm: lower.includes("palm"),
    hasCotton: lower.includes("cotton"),
    hasNavy: hasAny(lower, ["navy", "navy blue"]),
    hasGray: hasAny(lower, ["gray", "grey"]),
    hasBlue: lower.includes("blue"),
    hasBlackWhite: hasAny(lower, ["black/white", "black white"])
  };
}

function buildDaddySeoPhrase(productTitle: string, sourceUrl: string): { titleCore: string; style: string; opener: string; occasions: string[] } {
  const signals = inferProductSignals(productTitle, sourceUrl);

  if (signals.hasHawaiian && signals.hasBlue) {
    return {
      titleCore: "Matching Dad and Son Hawaiian Shirts",
      style: "Blue Tropical Cotton Button-Up",
      opener: "Stand out in matching dad and son style with these blue tropical Hawaiian shirts in breathable cotton.",
      occasions: ["beach vacations", "family photos", "luaus", "resort dinners", "summer outings"]
    };
  }

  if (signals.hasPalm && signals.hasBlackWhite) {
    return {
      titleCore: "Matching Dad and Son Hawaiian Shirts",
      style: "Black and White Palm Print",
      opener: "Shop matching dad and son palm print Hawaiian shirts with a crisp black and white tropical look.",
      occasions: ["vacations", "family photos", "beach trips", "summer outings", "weekend matching looks"]
    };
  }

  if (signals.hasPalm) {
    return {
      titleCore: "Matching Dad and Son Palm Print Hawaiian Shirts",
      style: signals.hasCotton ? "Cotton Tropical Vacation Style" : "Tropical Vacation Style",
      opener: "Shop matching dad and son palm print Hawaiian shirts for beach vacations, family photos, and warm-weather matching style.",
      occasions: ["beach vacations", "family photos", "resort trips", "summer outings", "weekend getaways"]
    };
  }

  if (signals.hasFloral && signals.hasNavy) {
    return {
      titleCore: "Matching Dad and Son Floral Button-Up Shirts",
      style: "Navy Blue Cotton Summer Style",
      opener: "Shop matching dad and son navy blue floral button-up shirts in breathable cotton for polished coordinated summer style.",
      occasions: ["family photos", "Father's Day outfits", "vacation dinners", "weekend outings", "summer matching looks"]
    };
  }

  if (signals.hasPaisley && signals.hasGray) {
    return {
      titleCore: "Matching Dad and Son Paisley Button-Up Shirts",
      style: "Gray Cotton Coordinated Style",
      opener: "Shop matching dad and son gray paisley button-up shirts in breathable cotton for a clean coordinated family look.",
      occasions: ["family photos", "casual outings", "Father's Day outfits", "vacations", "everyday matching style"]
    };
  }

  if (signals.hasFloral) {
    return {
      titleCore: "Matching Dad and Son Floral Shirts",
      style: signals.hasCotton ? "Cotton Button-Up Style" : "Floral Button-Up Style",
      opener: "Shop matching dad and son floral button-up shirts for a coordinated family look.",
      occasions: ["family photos", "vacations", "weekend outings", "seasonal matching moments"]
    };
  }

  return {
    titleCore: "Matching Dad and Son Button-Up Shirts",
    style: signals.hasCotton ? "Breathable Cotton Style" : "Coordinated Family Style",
    opener: "Shop matching dad and son button-up shirts for coordinated family style.",
    occasions: ["family photos", "seasonal outings", "weekend matching looks", "vacations"]
  };
}

function summarizeTitle(frontmatter: QueueFrontmatter, body: string, queueFileName: string): string {
  const preferred = extractHeading(body) || frontmatter.title || queueFileName.replace(/\.md$/i, "");
  return cleanWhitespace(normalizeQuotes(preferred));
}

function buildSearchText(packetParts: {
  title: string;
  sourceUrl: string;
  queueFileName: string;
  body: string;
  boardHint?: string;
}): string {
  return normalizeQuotes(
    [
      packetParts.title,
      packetParts.sourceUrl,
      packetParts.queueFileName,
      packetParts.body,
      packetParts.boardHint ?? ""
    ].join("\n")
  ).toLowerCase();
}

function matchRule(rule: Rule, haystack: string): boolean {
  const anyOkay = !rule.any || rule.any.some((token) => haystack.includes(token.toLowerCase()));
  const allOkay = !rule.all || rule.all.every((token) => haystack.includes(token.toLowerCase()));
  const noneOkay = !rule.none || rule.none.every((token) => !haystack.includes(token.toLowerCase()));
  return anyOkay && allOkay && noneOkay;
}

function chooseBoard(config: BoardRoutingConfig, haystack: string, boardHint?: string) {
  if (boardHint) {
    const exactBoard = config.safePublishBoards.find((board) => board.name.toLowerCase() === boardHint.toLowerCase());
    if (exactBoard) {
      return {
        board: exactBoard.name,
        confidence: "high" as const,
        reason: `Queue note provided exact approved board hint: ${exactBoard.name}.`,
        needsReview: false,
        reviewReason: null
      };
    }
    return {
      board: null,
      confidence: "low" as const,
      reason: `Queue note board hint "${boardHint}" is not in the approved board list.`,
      needsReview: true,
      reviewReason: "Board hint is not an approved existing board."
    };
  }

  const matches = config.rules
    .filter((rule) => matchRule(rule, haystack))
    .toSorted((left, right) => right.priority - left.priority);

  if (matches.length === 0) {
    return {
      board: null,
      confidence: "low" as const,
      reason: "No routing rule matched the queue note and product text.",
      needsReview: true,
      reviewReason: "No approved board matched the product."
    };
  }

  if (matches.length > 1 && matches[0].priority === matches[1].priority) {
    return {
      board: null,
      confidence: "low" as const,
      reason: `More than one board matched with the same priority: ${matches[0].board} and ${matches[1].board}.`,
      needsReview: true,
      reviewReason: "Board routing is ambiguous."
    };
  }

  const chosen = matches[0];
  return {
    board: chosen.board,
    confidence: "high" as const,
    reason: `Matched routing rule for ${chosen.board}.`,
    needsReview: false,
    reviewReason: null
  };
}

function compactTitle(productTitle: string, board: string | null, sourceUrl: string): string {
  const year = new Date().getFullYear();

  if (board === "Daddy & Me Outfits") {
    const seo = buildDaddySeoPhrase(productTitle, sourceUrl);
    const titleParts = `${seo.titleCore} ${seo.style}`.toLowerCase();
    const seasonalSuffix = !titleParts.includes("summer") && hasAny(seo.opener.toLowerCase() + " " + sourceUrl.toLowerCase(), ["hawaiian", "tropical", "beach", "summer", "vacation", "father's day"])
      ? ` for Summer ${year}`
      : "";
    return truncateTo(`${seo.titleCore}${seo.style ? ` | ${seo.style}` : ""}${seasonalSuffix}`, 100);
  }

  let title = cleanWhitespace(productTitle)
    .replace(/\s+\|\s+.+$/g, "")
    .replace(/\bDressLikeMommy\b/gi, "")
    .trim();

  return truncateTo(title, 100);
}

function buildHashtags(board: string | null, productTitle: string, sourceUrl: string): string[] {
  const lower = normalizeQuotes(`${productTitle} ${sourceUrl}`).toLowerCase();
  const signals = inferProductSignals(productTitle, sourceUrl);
  const hashtags = new Set<string>();

  if (board === "Daddy & Me Outfits") {
    [
      "#DaddyAndMe",
      "#FatherSonMatching",
      "#DadAndSon",
      "#FatherAndSon",
      "#MatchingOutfits",
      "#FamilyMatching"
    ].forEach((tag) => hashtags.add(tag));
  }

  if (board === "Mommy & Me Matching Outfits" || board === "Mother Daughter Dresses") {
    ["#MommyAndMe", "#MotherDaughter", "#MatchingOutfits", "#FamilyMatching"].forEach((tag) => hashtags.add(tag));
  }

  if (hasAny(lower, ["hawaiian", "tropical"])) {
    ["#HawaiianShirt", "#TropicalShirt", "#BeachStyle"].forEach((tag) => hashtags.add(tag));
  }

  if (lower.includes("floral")) {
    hashtags.add("#FloralPrint");
  }

  if (signals.hasPalm) {
    hashtags.add("#PalmPrint");
  }

  if (signals.hasFloral && lower.includes("button-up")) {
    hashtags.add("#FloralButtonUp");
  }

  if (signals.hasNavy) {
    hashtags.add("#NavyBlueShirt");
  }

  if (signals.hasPaisley) {
    hashtags.add("#PaisleyShirt");
  }

  if (board === "Daddy & Me Outfits") {
    hashtags.add("#FatherSonStyle");
  }

  if (lower.includes("cotton")) {
    hashtags.add("#CottonShirt");
  }

  if (hasAny(lower, ["beach", "vacation", "tropical", "summer"])) {
    ["#SummerOutfits", "#VacationStyle"].forEach((tag) => hashtags.add(tag));
  }

  if (hasAny(lower, ["floral", "paisley", "button-up"])) {
    hashtags.add("#SummerStyle");
  }

  if (hasAny(lower, ["father", "dad", "son"])) {
    hashtags.add("#FathersDayOutfit");
  }

  ["#FamilyPhotos", "#DressLikeMommy"].forEach((tag) => hashtags.add(tag));

  return Array.from(hashtags).slice(0, 16);
}

function buildDescription(board: string | null, productTitle: string, sourceUrl: string, hashtags: string[]): string {
  const lower = normalizeQuotes(`${productTitle} ${sourceUrl}`).toLowerCase();
  const hashtagBlock = hashtags.length > 0 ? `\n\n${hashtags.join(" ")}` : "";
  const uses = hasAny(lower, ["swim", "beach", "pool"])
      ? ["beach days", "pool trips", "vacation photos", "summer getaways"]
      : ["family photos", "seasonal outings", "coordinated moments"];

  if (board === "Daddy & Me Outfits") {
    const seo = buildDaddySeoPhrase(productTitle, sourceUrl);
    return `${seo.opener} Perfect for ${seo.occasions.join(", ")}. Shop the matching look at Dress Like Mommy with free shipping and 30-day returns.${hashtagBlock}`;
  }

  if (board === "Family Matching Swimwear") {
    return `${cleanWhitespace(productTitle)} designed for ${uses.join(", ")}. Shop the full family set at Dress Like Mommy with free shipping and 30-day returns.${hashtagBlock}`;
  }

  if (board === "Matching Family Easter Outfits") {
    return `${cleanWhitespace(productTitle)} for Easter gatherings, brunch, spring celebrations, and coordinated family photos. See the full product page at Dress Like Mommy.${hashtagBlock}`;
  }

  if (board === "Mother Daughter Dresses") {
    return `${cleanWhitespace(productTitle)} for parties, family photos, and polished matching moments together. Shop the full style at Dress Like Mommy with free shipping and 30-day returns.${hashtagBlock}`;
  }

  if (board === "Mommy & Me Matching Outfits") {
    return `${cleanWhitespace(productTitle)} for coordinated everyday style, family photos, and seasonal matching moments. Shop the full product page at Dress Like Mommy.${hashtagBlock}`;
  }

  return `${cleanWhitespace(productTitle)} for family photos, seasonal outings, and coordinated style. See the full product page for sizes, free shipping, and 30-day returns.${hashtagBlock}`;
}

function buildAltText(board: string | null, productTitle: string, sourceUrl: string): string {
  if (board === "Daddy & Me Outfits") {
    const signals = inferProductSignals(productTitle, sourceUrl);
    const styleParts = [
      signals.hasBlackWhite ? "black and white" : "",
      signals.hasGray ? "gray" : signals.hasNavy ? "navy blue" : signals.hasBlue ? "blue" : "",
      signals.hasPalm ? "palm print" : "",
      signals.hasPaisley ? "paisley" : signals.hasFloral ? "floral" : signals.hasHawaiian ? "tropical" : "",
      signals.hasCotton ? "cotton" : "",
      "short sleeve button-up shirts"
    ].filter(Boolean);
    return `Father and young son wearing matching ${styleParts.join(" ")}.`;
  }
  return `${productTitle} product image for Pinterest.`;
}

function buildProductTagSearchTerms(productTitle: string, sourceUrl: string, board: string | null): string[] {
  const handle = sourceUrl.split("/products/")[1]?.split(/[?#]/)[0] ?? "";
  const handlePhrase = cleanWhitespace(handle.replace(/-/g, " "));
  const simplifiedTitle = cleanWhitespace(
    productTitle
      .replace(/\bmen'?s\s*&\s*kids'?\s*/gi, "")
      .replace(/\bmatching\b/gi, "")
      .replace(/\s+-\s+/g, " ")
  );

  const boardPhrase =
    board === "Daddy & Me Outfits"
      ? cleanWhitespace(simplifiedTitle.replace(/\bkids'?\b/gi, "son").replace(/\bmen'?s\b/gi, "dad"))
      : simplifiedTitle;

  return Array.from(new Set([productTitle, boardPhrase, handlePhrase].filter(Boolean)));
}

function renderPrompt(template: string, packet: JobPacket, jobDir: string): string {
  const replacements = new Map<string, string>([
    ["{{JOB_ID}}", packet.jobId],
    ["{{QUEUE_NOTE}}", packet.queueNotePath],
    ["{{PRODUCT_TITLE}}", packet.productTitle],
    ["{{PRODUCT_URL}}", packet.sourceUrl],
    ["{{BOARD_NAME}}", packet.board ?? "REVIEW REQUIRED"],
    ["{{BOARD_CONFIDENCE}}", packet.boardConfidence],
    ["{{MAIN_IMAGE_URL}}", packet.mainImageUrl ?? "MISSING"],
    ["{{PIN_ASSET_PATH}}", path.join(jobDir, "pin-image.jpg")],
    ["{{PIN_TITLE}}", packet.draft.title],
    ["{{PIN_DESCRIPTION}}", packet.draft.description],
    ["{{PIN_HASHTAGS}}", packet.draft.hashtags.join(" ")],
    ["{{PRODUCT_TAG_SEARCH_TERMS}}", packet.draft.productTagSearchTerms.join(" | ")]
  ]);

  let output = template;
  for (const [needle, replacement] of replacements) {
    output = output.replaceAll(needle, replacement);
  }
  return output;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.queueNote) {
    throw new Error("Missing required --queue-note argument.");
  }

  const queueNotePath = path.resolve(args.queueNote);
  const queueFileName = path.basename(queueNotePath);
  const [queueRaw, configRaw, templateRaw] = await Promise.all([
    fs.readFile(queueNotePath, "utf8"),
    fs.readFile(path.resolve(args.configPath), "utf8"),
    fs.readFile(path.resolve(args.templatePath), "utf8")
  ]);

  const config = JSON.parse(configRaw) as BoardRoutingConfig;
  const { frontmatter, body } = splitFrontmatter(queueRaw);
  const sourceUrl = extractSourceUrl(frontmatter, body);
  if (!sourceUrl) {
    throw new Error(`Could not find a product URL in ${queueNotePath}.`);
  }

  const productTitle = summarizeTitle(frontmatter, body, queueFileName);
  const liveProductImage = await fetchLiveProductPageImage(sourceUrl);
  const queueNoteImage = extractMainImage(body);
  const mainImageUrl = liveProductImage.url ?? queueNoteImage;
  const mainImageAlt = liveProductImage.alt ?? null;
  const mainImageSource = liveProductImage.url ? "product-page-first-gallery-image" : "queue-note-fallback";
  const haystack = buildSearchText({
    title: productTitle,
    sourceUrl,
    queueFileName,
    body,
    boardHint: frontmatter.board_hint
  });
  const routing = chooseBoard(config, haystack, frontmatter.board_hint);
  const slug = slugify(queueFileName.replace(/\.md$/i, ""));
  const jobId = `${new Date().toISOString().slice(0, 10)}-${slug}`;
  const jobDir = path.join(path.resolve(args.jobRoot), slug);

  const hashtags = buildHashtags(routing.board, productTitle, sourceUrl);
  const packet: JobPacket = {
    jobId,
    generatedAt: new Date().toISOString(),
    queueNotePath,
    queueNoteName: queueFileName,
    productTitle,
    sourceUrl,
    mainImageUrl,
    mainImageAlt,
    mainImageSource,
    language: frontmatter.language ?? "en",
    board: routing.board,
    boardConfidence: routing.confidence,
    boardReason: routing.reason,
    needsReview: routing.needsReview,
    reviewReason: routing.reviewReason,
    pinSpec: {
      width: 1000,
      height: 1500,
      aspectRatio: "2:3"
    },
    draft: {
      title: compactTitle(productTitle, routing.board, sourceUrl),
      description: buildDescription(routing.board, productTitle, sourceUrl, hashtags),
      altText: buildAltText(routing.board, productTitle, sourceUrl),
      destinationUrl: buildDestinationUrl(sourceUrl, queueFileName.replace(/\.md$/i, "")),
      hashtags,
      productTagSearchTerms: buildProductTagSearchTerms(productTitle, sourceUrl, routing.board)
    },
    fieldsUsed: {
      boardHint: frontmatter.board_hint ?? null,
      priority: frontmatter.priority ?? null,
      campaign: frontmatter.campaign ?? null,
      notes: frontmatter.notes ?? null
    }
  };

  const summaryLines = [
    `# ${packet.productTitle}`,
    "",
    `- Job ID: \`${packet.jobId}\``,
    `- Queue note: \`${packet.queueNotePath}\``,
    `- Product URL: ${packet.sourceUrl}`,
    `- Main image URL: ${packet.mainImageUrl ?? "MISSING"}`,
    `- Board: ${packet.board ?? "REVIEW REQUIRED"}`,
    `- Board reason: ${packet.boardReason}`,
    `- Needs review: ${packet.needsReview ? "yes" : "no"}`,
    `- Draft title: ${packet.draft.title}`,
    `- Draft destination URL: ${packet.draft.destinationUrl}`,
    `- Draft description: ${packet.draft.description}`,
    `- Draft alt text: ${packet.draft.altText}`
  ].join("\n");

  const prompt = renderPrompt(templateRaw, packet, jobDir);

  await fs.mkdir(jobDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(jobDir, "packet.json"), JSON.stringify(packet, null, 2) + "\n"),
    fs.writeFile(path.join(jobDir, "summary.md"), summaryLines + "\n"),
    fs.writeFile(path.join(jobDir, "agent-prompt.md"), prompt + "\n")
  ]);

  process.stdout.write(`${jobDir}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
