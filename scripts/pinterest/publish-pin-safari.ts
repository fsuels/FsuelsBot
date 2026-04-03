import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type JobPacket = {
  board: string | null;
  draft: {
    title: string;
    description: string;
    altText: string;
  };
  sourceUrl: string;
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
    jobPath: args.get("--job")
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function step(label: string) {
  process.stdout.write(`\n[${new Date().toISOString()}] ${label}\n`);
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script], { encoding: "utf8" });
  return stdout.trim();
}

async function runSafariJs(js: string): Promise<string> {
  const tempPath = path.join(os.tmpdir(), `pinterest-safari-${Date.now()}-${Math.random().toString(16).slice(2)}.js`);
  await fs.writeFile(tempPath, js);
  const script = `
set js to read POSIX file "${tempPath}" as «class utf8»
tell application "Safari"
  do JavaScript js in front document
end tell
`;

  try {
    return await runAppleScript(script);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

async function activateSafari() {
  await runAppleScript(`tell application "Safari" to activate`);
}

async function getFrontWindowBounds() {
  const raw = await runAppleScript(`
tell application "Safari"
  return bounds of front window
end tell
`);
  const [left, top] = raw.split(",").map((part) => Number(part.trim()));
  return { left, top };
}

async function clickAbsolute(x: number, y: number) {
  execFileSync("/opt/homebrew/bin/cliclick", [`c:${x},${y}`], { stdio: "ignore" });
}

async function waitFor(
  label: string,
  producer: () => Promise<string>,
  predicate: (value: string) => boolean,
  timeoutMs = 20000,
  intervalMs = 1000
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await producer();
    if (predicate(value)) {
      return value;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out while waiting for ${label}.`);
}

async function browserState() {
  const output = execFileSync(path.join(process.cwd(), "scripts/pinterest/browser-state.sh"), [], { encoding: "utf8" });
  process.stdout.write(output + "\n");
}

async function navigateToBuilder() {
  await activateSafari();
  await runAppleScript(`
tell application "Safari"
  tell front document
    set URL to "https://www.pinterest.com/pin-builder/"
  end tell
end tell
`);
  await waitFor(
    "Pin Builder",
    () => runSafariJs(`JSON.stringify({ url: location.href, body: document.body.innerText.slice(0, 2000) })`),
    (value) => value.includes(`"url":"https://www.pinterest.com/pin-builder/"`) && value.includes("Pin Builder"),
    20000,
    1000
  );
}

async function uploadAsset(assetPath: string) {
  const uploadDir = path.join(os.tmpdir(), `pinterest-upload-${Date.now()}`);
  await fs.mkdir(uploadDir, { recursive: true });
  const uploadTarget = path.join(uploadDir, "a-pin-image.jpg");
  await fs.copyFile(assetPath, uploadTarget);

  await activateSafari();
  await runSafariJs(`
(() => {
  const adsOnly = document.querySelector('input[name="is-ads-only-toggle"]');
  if (adsOnly && adsOnly.checked) {
    adsOnly.click();
    adsOnly.dispatchEvent(new Event('input', { bubbles: true }));
    adsOnly.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const input = document.querySelector('input[type=file][aria-label="File upload"]');
  if (!input) {
    throw new Error('Missing file upload input.');
  }
  input.click();
  return 'READY';
})()
`);

  await sleep(1000);
  await runAppleScript(`
tell application "System Events"
  keystroke "G" using {command down, shift down}
  delay 0.4
  keystroke "${uploadDir.replace(/\\/g, "\\\\")}"
  delay 0.4
  key code 36
  delay 0.6
  keystroke "a" using command down
  delay 0.3
  key code 36
end tell
`);

  await waitFor(
    "uploaded image",
    () =>
      runSafariJs(`
JSON.stringify({
  hasUploadedImage: !!Array.from(document.querySelectorAll('img')).find((img) => img.alt === 'Uploaded image'),
  hasErrorBanner: !!document.querySelector('button[aria-label="Close Error Banner"]'),
  body: document.body.innerText.slice(0, 2000)
})
`),
    (value) => value.includes(`"hasUploadedImage":true`) && !value.includes(`"hasErrorBanner":true`),
    30000,
    1000
  );
}

async function fillStableFields(packet: JobPacket) {
  await runSafariJs(`
(() => {
  const setNativeValue = (element, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const title = document.querySelector('textarea[placeholder="Add your title"]');
  const link = document.querySelector('textarea[placeholder="Add a destination link"]');

  if (!title || !link) {
    throw new Error('Missing title or link field.');
  }

  setNativeValue(title, ${JSON.stringify(packet.draft.title)});
  setNativeValue(link, ${JSON.stringify(packet.sourceUrl)});
  return JSON.stringify({ title: title.value, link: link.value });
})()
`);
}

async function tagProductByUrl(packet: JobPacket) {
  await runSafariJs(`
(() => {
  const tag = document.querySelector('button[aria-label="Tag products"]');
  if (!tag) {
    throw new Error('Missing Tag products button.');
  }
  tag.click();
  return 'OK';
})()
`);

  await waitFor(
    "tag panel",
    () => runSafariJs(`document.body.innerText.slice(0, 2000)`),
    (value) => value.includes("Add products"),
    15000,
    500
  );

  await runSafariJs(`
(() => {
  const add = document.querySelector('button[aria-label="Add product tag"]');
  const image = Array.from(document.querySelectorAll('img')).find((img) => img.alt === 'Uploaded image');
  if (!add || !image) {
    throw new Error('Missing add tag control or uploaded image.');
  }
  add.click();
  const rect = image.getBoundingClientRect();
  const x = rect.left + rect.width * 0.5;
  const y = rect.top + rect.height * 0.55;
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
    image.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, view: window }));
  });
  return 'OK';
})()
`);

  await runSafariJs(`
(() => {
  const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) => (el.innerText || '').trim() === 'URL');
  if (!tab) {
    throw new Error('Missing URL tab.');
  }
  tab.click();
  const input = document.querySelector('input[type="url"][placeholder="Enter your website URL"]');
  if (!input) {
    throw new Error('Missing website URL field.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
  descriptor.set.call(input, ${JSON.stringify(packet.sourceUrl)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const submit = Array.from(document.querySelectorAll('button')).find((button) => button.querySelector('svg[aria-label="Submit"]'));
  if (!submit) {
    throw new Error('Missing URL submit button.');
  }
  submit.click();
  return 'OK';
})()
`);

  await waitFor(
    "product images from URL",
    () => runSafariJs(`String(document.querySelectorAll('[role="dialog"] img').length)`),
    (value) => Number(value) > 0,
    20000,
    1000
  );

  await runSafariJs(`
(() => {
  const first = document.querySelector('[role="dialog"] img');
  if (!first) {
    throw new Error('Missing first product image.');
  }
  first.click();
  return 'OK';
})()
`);

  await waitFor(
    "Save product screen",
    () => runSafariJs(`document.body.innerText.slice(0, 2000)`),
    (value) => value.includes("Save product"),
    15000,
    500
  );

  await runSafariJs(`
(() => {
  const input = document.querySelector('[role="dialog"] input[type="url"]');
  const save = Array.from(document.querySelectorAll('button')).find((el) => (el.innerText || '').trim() === 'Save product');
  if (!input || !save) {
    throw new Error('Missing product link input or Save product button.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
  descriptor.set.call(input, ${JSON.stringify(packet.sourceUrl)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  save.click();
  return 'OK';
})()
`);

  await waitFor(
    "1 product attached",
    () => runSafariJs(`document.body.innerText.slice(0, 2000)`),
    (value) => value.includes("1 product"),
    15000,
    500
  );

  await runSafariJs(`
(() => {
  const done = Array.from(document.querySelectorAll('button')).find((el) => (el.innerText || '').trim() === 'Done');
  if (!done) {
    throw new Error('Missing Done button.');
  }
  done.click();
  return 'OK';
})()
`);
}

async function fillAltAndDescription(packet: JobPacket) {
  await waitFor(
    "alt text field",
    async () => {
      const result = await runSafariJs(`
(() => {
  let alt = document.querySelector('textarea[placeholder="Explain what people can see in the Pin"]');
  if (!alt) {
    const button = Array.from(document.querySelectorAll('button')).find((el) => (el.innerText || '').trim() === 'Add alt text');
    if (button) {
      button.click();
      alt = document.querySelector('textarea[placeholder="Explain what people can see in the Pin"]');
    }
  }
  return String(Boolean(alt));
})()
`);
      return result;
    },
    (value) => value === "true",
    15000,
    500
  );

  await runSafariJs(`
(() => {
  const alt = document.querySelector('textarea[placeholder="Explain what people can see in the Pin"]');
  if (!alt) {
    throw new Error('Missing alt textarea.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(alt), 'value');
  descriptor.set.call(alt, ${JSON.stringify(packet.draft.altText)});
  alt.dispatchEvent(new Event('input', { bubbles: true }));
  alt.dispatchEvent(new Event('change', { bubbles: true }));
  alt.dispatchEvent(new Event('blur', { bubbles: true }));

  const editor = document.querySelector('[aria-label="Tell everyone what your Pin is about"][contenteditable="true"]');
  if (!editor) {
    throw new Error('Missing description editor.');
  }

  const fiberKey = Object.getOwnPropertyNames(editor).find((key) => key.startsWith('__reactFiber$'));
  let node = editor[fiberKey];
  while (node && !(node.memoizedProps && node.memoizedProps.editorState && node.memoizedProps.onChange)) {
    node = node.return;
  }
  if (!node) {
    throw new Error('Could not find editor state node.');
  }

  const state = node.memoizedProps.editorState;
  const EditorState = state.constructor;
  const ContentState = state.getCurrentContent().constructor;
  const newContent = ContentState.createFromText(${JSON.stringify(packet.draft.description)});
  const nextState = EditorState.push(state, newContent, 'insert-characters');
  node.memoizedProps.onChange(nextState);
  return 'OK';
})()
`);
}

async function verifyBuilder(packet: JobPacket) {
  const raw = await runSafariJs(`
JSON.stringify({
  title: document.querySelector('textarea[placeholder="Add your title"]')?.value || null,
  link: document.querySelector('textarea[placeholder="Add a destination link"]')?.value || null,
  alt: document.querySelector('textarea[placeholder="Explain what people can see in the Pin"]')?.value || null,
  description: document.querySelector('[aria-label="Tell everyone what your Pin is about"][contenteditable="true"]')?.innerText || null,
  adOnly: document.querySelector('input[name="is-ads-only-toggle"]')?.checked ?? null,
  body: document.body.innerText.slice(0, 3000)
})
`);
  const state = JSON.parse(raw) as {
    title: string | null;
    link: string | null;
    alt: string | null;
    description: string | null;
    adOnly: boolean | null;
    body: string;
  };

  if (state.title !== packet.draft.title) {
    throw new Error("Title verification failed.");
  }
  if (state.link !== packet.sourceUrl) {
    throw new Error("Destination link verification failed.");
  }
  if (state.alt !== packet.draft.altText) {
    throw new Error("Alt text verification failed.");
  }
  if (!state.description?.includes(packet.draft.description.split("\n")[0])) {
    throw new Error("Description verification failed.");
  }
  if (state.adOnly !== false) {
    throw new Error("Ad-only toggle verification failed.");
  }
  if (!state.body.includes("1 product")) {
    throw new Error("Product tag verification failed.");
  }
}

async function publishAndOpenPin() {
  const closeError = await runSafariJs(`
(() => {
  const button = document.querySelector('button[aria-label="Close Error Banner"]');
  if (button) button.click();
  return 'OK';
})()
`);
  void closeError;

  const rectRaw = await runSafariJs(`
JSON.stringify((() => {
  const el = Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => (node.innerText || '').trim() === 'Publish');
  if (!el) {
    throw new Error('Missing Publish button.');
  }
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
})())
`);
  const rect = JSON.parse(rectRaw) as { left: number; top: number; width: number; height: number };
  const bounds = await getFrontWindowBounds();
  await activateSafari();
  await sleep(800);
  await clickAbsolute(
    Math.round(bounds.left + rect.left + rect.width / 2),
    Math.round(bounds.top + rect.top + rect.height / 2)
  );

  const result = await waitFor(
    "publish result",
    () => runSafariJs(`JSON.stringify({ url: location.href, body: document.body.innerText.slice(0, 4000) })`),
    (value) => value.includes("You created a Pin!") || value.includes(`"url":"https://www.pinterest.com/pin/`) || value.includes("/dresslikemommy/daddy-me-outfits/"),
    30000,
    1000
  );

  if (result.includes("You must fix the highlighted issues")) {
    throw new Error("Pinterest reported highlighted issues before publish completed.");
  }

  if (result.includes("You created a Pin!")) {
    await runSafariJs(`
(() => {
  const seePin = Array.from(document.querySelectorAll('button, [role="button"], a')).find((el) => (el.innerText || '').trim() === 'See your Pin');
  if (!seePin) {
    throw new Error('Missing See your Pin link.');
  }
  seePin.click();
  return 'OK';
})()
`);
  }

  const finalState = await waitFor(
    "live pin page",
    () => runSafariJs(`JSON.stringify({ url: location.href, title: document.title, body: document.body.innerText.slice(0, 4000) })`),
    (value) => value.includes(`"url":"https://www.pinterest.com/pin/`) && value.includes("Visit site"),
    30000,
    1000
  );
  return finalState;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobPath) {
    throw new Error("Missing required --job argument.");
  }

  const jobPath = path.resolve(args.jobPath);
  const jobDir = path.dirname(jobPath);
  const packet = JSON.parse(await fs.readFile(jobPath, "utf8")) as JobPacket;
  const assetPath = path.join(jobDir, "pin-image.jpg");

  step("Browser state");
  await browserState();

  step("Navigate to Safari Pin Builder");
  await navigateToBuilder();

  step("Upload image");
  await uploadAsset(assetPath);

  step("Fill title and destination link");
  await fillStableFields(packet);

  step("Attach product tag");
  await tagProductByUrl(packet);

  step("Fill alt text and description");
  await fillAltAndDescription(packet);

  step("Verify builder state");
  await verifyBuilder(packet);

  step("Publish and open live pin");
  const finalState = await publishAndOpenPin();
  process.stdout.write(finalState + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
