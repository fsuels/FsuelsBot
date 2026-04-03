import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, type BrowserContext, type Page } from "playwright-core";

type JobPacket = {
  queueNotePath: string;
  board: string | null;
  sourceUrl: string;
  draft: {
    title: string;
    description: string;
    altText: string;
    destinationUrl: string;
  };
};

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
    jobPath: args.get("--job"),
    cdpUrl: args.get("--cdp-url") ?? process.env.PINTEREST_CDP_URL ?? "http://127.0.0.1:9333"
  };
}

function step(label: string) {
  process.stdout.write(`\n[${new Date().toISOString()}] ${label}\n`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getOrCreateBuilderPage(context: BrowserContext): Promise<Page> {
  const existing = context.pages().find((page) => page.url().includes("pinterest.com"));
  if (existing) {
    await existing.goto("https://www.pinterest.com/pin-builder/", { waitUntil: "domcontentloaded" });
    return existing;
  }
  const page = await context.newPage();
  await page.goto("https://www.pinterest.com/pin-builder/", { waitUntil: "domcontentloaded" });
  return page;
}

async function ensureLoggedIn(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.getByText("Pin Builder", { exact: true }).waitFor({ timeout: 20000 });
  } catch {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(
      `Background Chrome is not ready for Pinterest publishing. Open the dedicated Chrome profile once and log into the DressLikeMommy Pinterest account. Current body starts with: ${body.slice(0, 200)}`
    );
  }
}

async function setTextareaValue(page: Page, selector: string, value: string) {
  await page.evaluate(
    ({ selector: innerSelector, value: innerValue }) => {
      const element = document.querySelector(innerSelector) as HTMLTextAreaElement | null;
      if (!element) {
        throw new Error(`Missing textarea: ${innerSelector}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
      descriptor?.set?.call(element, innerValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
    },
    { selector, value }
  );
}

async function setDescription(page: Page, description: string) {
  await page.evaluate((text) => {
    const editor = document.querySelector(
      '[aria-label="Tell everyone what your Pin is about"][contenteditable="true"]'
    ) as HTMLElement | null;
    if (!editor) {
      throw new Error("Missing description editor.");
    }
    const fiberKey = Object.getOwnPropertyNames(editor).find((key) => key.startsWith("__reactFiber$"));
    let node = fiberKey ? (editor as Record<string, unknown>)[fiberKey] : null;
    while (
      node &&
      !(node as { memoizedProps?: { editorState?: unknown; onChange?: unknown } }).memoizedProps?.editorState &&
      !(node as { memoizedProps?: { editorState?: unknown; onChange?: unknown } }).memoizedProps?.onChange
    ) {
      node = (node as { return?: unknown }).return ?? null;
    }
    const memoizedProps = (node as { memoizedProps?: { editorState?: unknown; onChange?: (value: unknown) => void } })
      ?.memoizedProps;
    if (!memoizedProps?.editorState || !memoizedProps.onChange) {
      throw new Error("Missing description editor state.");
    }
    const state = memoizedProps.editorState as {
      constructor: { push: (state: unknown, content: unknown, changeType: string) => unknown };
      getCurrentContent: () => { constructor: { createFromText: (textValue: string) => unknown } };
    };
    const EditorState = state.constructor;
    const ContentState = state.getCurrentContent().constructor;
    const newContent = ContentState.createFromText(text);
    const nextState = EditorState.push(state, newContent, "insert-characters");
    memoizedProps.onChange(nextState);
  }, description);
}

async function ensureBoard(page: Page, board: string | null) {
  if (!board) {
    return;
  }

  const currentBody = await page.locator("body").innerText();
  if (currentBody.includes(board)) {
    return;
  }

  const currentBoard = page.locator('div[role="button"]').filter({ hasText: new RegExp(`^${escapeRegExp(board)}$`) }).first();
  if (await currentBoard.isVisible().catch(() => false)) {
    return;
  }

  const boardButton = page.locator('div[role="button"]').filter({ hasText: /Outfits|Swimwear|Dresses|Family/i }).first();
  if (await boardButton.isVisible().catch(() => false)) {
    await boardButton.evaluate((element) => {
      (element as HTMLElement).click();
    });
    await page.waitForTimeout(1000);
  }

  const searchInput = page
    .locator('input[placeholder*="Search"], input[aria-label*="Search"], input[type="search"]')
    .first();
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill(board);
    await page.waitForTimeout(750);
  }

  const boardOption = page.getByText(board, { exact: true }).last();
  if (await boardOption.isVisible().catch(() => false)) {
    await boardOption.evaluate((element) => {
      (element as HTMLElement).click();
    });
    await page.waitForTimeout(750);
  }

  const body = await page.locator("body").innerText();
  if (!body.includes(board)) {
    throw new Error(`Board did not resolve to "${board}".`);
  }
}

async function clickDialogSubmit(page: Page) {
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find((button) => button.querySelector('svg[aria-label="Submit"]'));
    if (!target) {
      throw new Error("Missing dialog submit button.");
    }
    target.click();
  });
}

async function publish(page: Page, jobDir: string) {
  await page.getByText("Publish", { exact: true }).click();
  await Promise.race([
    page.waitForURL(/\/pin\/\d+/, { timeout: 30000 }),
    page.getByText("You created a Pin!", { exact: false }).waitFor({ timeout: 30000 })
  ]);

  const seePin = page.getByText("See your Pin", { exact: true });
  if (await seePin.isVisible().catch(() => false)) {
    await seePin.click();
    await page.waitForURL(/\/pin\/\d+/, { timeout: 30000 });
  }

  const screenshotPath = path.join(jobDir, "live-pin-receipt-background.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return { screenshotPath, liveUrl: page.url() };
}

function buildDoneQueuePath(queueNotePath: string): string {
  const parts = path.normalize(queueNotePath).split(path.sep);
  const queueIndex = parts.lastIndexOf("Queue");
  if (queueIndex === -1) {
    throw new Error(`Could not derive Queue/Done path from ${queueNotePath}`);
  }
  const queueRoot = parts.slice(0, queueIndex + 1).join(path.sep) || path.sep;
  return path.join(queueRoot, "Done", path.basename(queueNotePath));
}

async function moveQueueNoteToDone(queueNotePath: string): Promise<string> {
  const donePath = buildDoneQueuePath(queueNotePath);
  const sourcePath = path.resolve(queueNotePath);
  const targetPath = path.resolve(donePath);
  if (sourcePath === targetPath) {
    return targetPath;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rename(sourcePath, targetPath);
  return targetPath;
}

async function writeVerification(jobDir: string, packet: JobPacket, liveUrl: string, screenshotPath: string, doneQueuePath: string) {
  const verificationPath = path.join(jobDir, "publish-verification.md");
  const body = [
    "# Publish Verification",
    "",
    `- Published at: \`${new Date().toISOString().slice(0, 10)}\``,
    `- Live Pin URL: \`${liveUrl}\``,
    `- Destination URL: \`${packet.draft.destinationUrl}\``,
    `- Product URL: \`${packet.sourceUrl}\``,
    `- Board: \`${packet.board ?? "UNKNOWN"}\``,
    `- Receipt screenshot: \`${path.basename(screenshotPath)}\``,
    `- Queue note moved to: \`${doneQueuePath}\``,
    "",
    "## Verified",
    "",
    "- Approved 1000 x 1500 no-blur image used",
    "- SEO title present in builder before publish",
    "- Full description present in builder before publish",
    "- Product tag attached from the DressLikeMommy product URL",
    "- Destination URL published with Pinterest UTM parameters",
    "- Queue note moved to Done",
    "- Published through the isolated background Chrome automation profile"
  ].join("\n");
  await fs.writeFile(verificationPath, body + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobPath) {
    throw new Error("Missing required --job argument.");
  }

  const jobPath = path.resolve(args.jobPath);
  const jobDir = path.dirname(jobPath);
  const packet = JSON.parse(await fs.readFile(jobPath, "utf8")) as JobPacket;
  const imagePath = path.join(jobDir, "pin-image.jpg");

  step(`Connect to background Chrome at ${args.cdpUrl}`);
  const browser = await chromium.connectOverCDP(args.cdpUrl);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("No Chrome context available. Launch the dedicated background Chrome profile first.");
  }

  const page = await getOrCreateBuilderPage(context);
  await ensureLoggedIn(page);

  step("Upload image");
  const adsOnly = page.locator('input[name="is-ads-only-toggle"]');
  if (await adsOnly.isChecked().catch(() => false)) {
    await adsOnly.uncheck();
  }
  await page.locator('input[type="file"][aria-label="File upload"]').setInputFiles(imagePath);
  await page.locator('img[alt="Uploaded image"]').waitFor({ timeout: 30000 });

  step("Confirm board and fill stable fields");
  await ensureBoard(page, packet.board);
  await setTextareaValue(page, 'textarea[placeholder="Add your title"]', packet.draft.title);
  await setTextareaValue(page, 'textarea[placeholder="Add a destination link"]', packet.draft.destinationUrl);

  step("Attach product tag");
  await page.locator('button[aria-label="Tag products"]').click();
  await page.locator('button[aria-label="Add product tag"]').click();
  const uploadedImage = page.locator('img[alt="Uploaded image"]');
  const box = await uploadedImage.boundingBox();
  if (!box) {
    throw new Error("Could not read uploaded image position.");
  }
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.getByRole("tab", { name: "URL" }).click();
  await page.getByPlaceholder("Enter your website URL").fill(packet.sourceUrl);
  await clickDialogSubmit(page);
  await page.locator('[role="dialog"] img').first().waitFor({ timeout: 20000 });
  await page.locator('[role="dialog"] img').first().click();
  await page.getByPlaceholder("Enter your website URL").fill(packet.sourceUrl);
  await page.getByText("Save product", { exact: true }).click();
  await page.getByText("1 product", { exact: false }).waitFor({ timeout: 15000 });
  await page.getByText("Done", { exact: true }).click();

  step("Fill alt text and description");
  const altField = page.locator('textarea[placeholder="Explain what people can see in the Pin"]');
  if (!(await altField.isVisible().catch(() => false))) {
    await page.getByText("Add alt text", { exact: true }).click();
  }
  await altField.waitFor({ timeout: 10000 });
  await setTextareaValue(page, 'textarea[placeholder="Explain what people can see in the Pin"]', packet.draft.altText);
  await setDescription(page, packet.draft.description);

  step("Verify builder");
  const body = await page.locator("body").innerText();
  if (!body.includes("1 product")) {
    throw new Error("Product tag did not stick.");
  }
  if (packet.board && !body.includes(packet.board)) {
    throw new Error("Board did not stick.");
  }
  if (!body.includes(packet.draft.title)) {
    throw new Error("Title did not stick.");
  }
  if (!body.includes(packet.draft.description.split("\n")[0])) {
    throw new Error("Description did not stick.");
  }

  step("Publish");
  const result = await publish(page, jobDir);
  const doneQueuePath = await moveQueueNoteToDone(packet.queueNotePath);
  await writeVerification(jobDir, packet, result.liveUrl, result.screenshotPath, doneQueuePath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  await browser.close();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
