import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

function makeTempPath(targetPath: string) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  return path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
}

function fsyncDirectorySync(dirPath: string) {
  let dirFd: number | undefined;
  try {
    dirFd = fs.openSync(dirPath, "r");
    fs.fsyncSync(dirFd);
  } catch {
    // Best effort: some platforms/filesystems do not support syncing directories.
  } finally {
    if (dirFd !== undefined) {
      try {
        fs.closeSync(dirFd);
      } catch {
        // ignore
      }
    }
  }
}

async function fsyncDirectory(dirPath: string) {
  let handle: fsPromises.FileHandle | undefined;
  try {
    handle = await fsPromises.open(dirPath, "r");
    await handle.sync();
  } catch {
    // Best effort: some platforms/filesystems do not support syncing directories.
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // ignore
      }
    }
  }
}

export async function writeTextFileAtomic(
  targetPath: string,
  content: string,
  options?: { mode?: number },
) {
  const dir = path.dirname(targetPath);
  await fsPromises.mkdir(dir, { recursive: true });
  const tempPath = makeTempPath(targetPath);
  let handle: fsPromises.FileHandle | undefined;
  try {
    handle = await fsPromises.open(tempPath, "wx", options?.mode ?? 0o600);
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsPromises.rename(tempPath, targetPath);
    await fsyncDirectory(dir);
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // ignore
      }
    }
    try {
      await fsPromises.unlink(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export function writeTextFileAtomicSync(
  targetPath: string,
  content: string,
  options?: { mode?: number },
) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = makeTempPath(targetPath);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, "wx", options?.mode ?? 0o600);
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, targetPath);
    fsyncDirectorySync(dir);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }
}
