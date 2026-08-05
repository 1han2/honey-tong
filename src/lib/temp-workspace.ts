import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const directoryBytes = async (directory: string): Promise<number> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(entryPath);
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
  }
  return total;
};

export class TempWorkspace {
  readonly root: string;
  readonly publicDir: string;

  private constructor(
    root: string,
    private readonly maxBytes: number,
  ) {
    this.root = root;
    this.publicDir = path.join(root, "public");
  }

  static async create(maxBytes: number): Promise<TempWorkspace> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "shorts-produce-"));
    const workspace = new TempWorkspace(root, maxBytes);
    await fs.mkdir(workspace.publicDir, { recursive: true });
    return workspace;
  }

  assetPath(fileName: string): string {
    return path.join(this.publicDir, fileName);
  }

  outputPath(): string {
    return path.join(this.root, "output.mp4");
  }

  async assertWithinLimit(): Promise<void> {
    const bytes = await directoryBytes(this.root);
    if (bytes > this.maxBytes) {
      throw new Error(`Temporary workspace limit exceeded: ${bytes} > ${this.maxBytes}`);
    }
  }

  async cleanup(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}
