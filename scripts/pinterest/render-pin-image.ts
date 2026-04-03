import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

type JobPacket = {
  productTitle: string;
  sourceUrl: string;
  mainImageUrl: string | null;
  pinSpec: {
    width: number;
    height: number;
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
    jobPath: args.get("--job")
  };
}

function extensionFromUrl(url: string): string {
  const clean = url.split("?")[0];
  const ext = path.extname(clean).toLowerCase();
  if (ext === ".png" || ext === ".webp" || ext === ".jpeg" || ext === ".jpg") {
    return ext;
  }
  return ".jpg";
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status} for ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobPath) {
    throw new Error("Missing required --job argument.");
  }

  const jobPath = path.resolve(args.jobPath);
  const jobDir = path.dirname(jobPath);
  const packetRaw = await fs.readFile(jobPath, "utf8");
  const packet = JSON.parse(packetRaw) as JobPacket;

  if (!packet.mainImageUrl) {
    throw new Error(`No mainImageUrl found in ${jobPath}`);
  }

  const sourceBuffer = await downloadBuffer(packet.mainImageUrl);
  const sourceExt = extensionFromUrl(packet.mainImageUrl);
  const sourceImagePath = path.join(jobDir, `source-image${sourceExt}`);
  const outputImagePath = path.join(jobDir, "pin-image.jpg");
  const metadataPath = path.join(jobDir, "image-meta.json");

  const width = packet.pinSpec.width ?? 1000;
  const height = packet.pinSpec.height ?? 1500;
  const sourceMeta = await sharp(sourceBuffer).metadata();
  const sourceWidth = sourceMeta.width ?? width;
  const sourceHeight = sourceMeta.height ?? height;
  const targetRatio = width / height;
  const sourceRatio = sourceWidth / sourceHeight;

  await fs.writeFile(sourceImagePath, sourceBuffer);

  if (sourceRatio <= targetRatio + 0.12) {
    await sharp(sourceBuffer)
      .resize(width, height, { fit: "cover", position: "attention" })
      .sharpen()
      .jpeg({ quality: 94, mozjpeg: true })
      .toFile(outputImagePath);
  } else {
    const foreground = await sharp(sourceBuffer)
      .resize(width, height, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .toBuffer();

    const foregroundMeta = await sharp(foreground).metadata();
    const renderedWidth = foregroundMeta.width ?? width;
    const renderedHeight = foregroundMeta.height ?? height;
    const leftGap = Math.max(0, Math.floor((width - renderedWidth) / 2));
    const rightGap = Math.max(0, width - renderedWidth - leftGap);
    const topGap = Math.max(0, Math.floor((height - renderedHeight) / 2));
    const bottomGap = Math.max(0, height - renderedHeight - topGap);

    const composites: sharp.OverlayOptions[] = [{ input: foreground, left: leftGap, top: topGap }];
    const centerImage = sharp(foreground);

    if (leftGap > 0) {
      const leftStrip = await centerImage
        .clone()
        .extract({ left: leftGap, top: topGap, width: Math.min(24, renderedWidth), height: renderedHeight })
        .resize(leftGap, renderedHeight, { fit: "fill" })
        .toBuffer();
      composites.push({ input: leftStrip, left: 0, top: topGap });
    }

    if (rightGap > 0) {
      const stripWidth = Math.min(24, renderedWidth);
      const rightStrip = await centerImage
        .clone()
        .extract({
          left: Math.max(leftGap, width - rightGap - stripWidth),
          top: topGap,
          width: stripWidth,
          height: renderedHeight
        })
        .resize(rightGap, renderedHeight, { fit: "fill" })
        .toBuffer();
      composites.push({ input: rightStrip, left: width - rightGap, top: topGap });
    }

    if (topGap > 0) {
      const topStrip = await centerImage
        .clone()
        .extract({ left: leftGap, top: topGap, width: renderedWidth, height: Math.min(24, renderedHeight) })
        .resize(renderedWidth, topGap, { fit: "fill" })
        .toBuffer();
      composites.push({ input: topStrip, left: leftGap, top: 0 });
    }

    if (bottomGap > 0) {
      const stripHeight = Math.min(24, renderedHeight);
      const bottomStrip = await centerImage
        .clone()
        .extract({
          left: leftGap,
          top: Math.max(topGap, height - bottomGap - stripHeight),
          width: renderedWidth,
          height: stripHeight
        })
        .resize(renderedWidth, bottomGap, { fit: "fill" })
        .toBuffer();
      composites.push({ input: bottomStrip, left: leftGap, top: height - bottomGap });
    }

    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .composite(composites)
      .sharpen()
      .jpeg({ quality: 94, mozjpeg: true })
      .toFile(outputImagePath);
  }

  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        productTitle: packet.productTitle,
        productUrl: packet.sourceUrl,
        sourceImageUrl: packet.mainImageUrl,
        sourceImagePath,
        outputImagePath,
        sourceWidth: sourceMeta.width,
        sourceHeight: sourceMeta.height,
        outputWidth: width,
        outputHeight: height,
        renderMode: sourceRatio <= targetRatio + 0.12 ? "cover-crop" : "edge-extend"
      },
      null,
      2
    ) + "\n"
  );

  process.stdout.write(outputImagePath + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
