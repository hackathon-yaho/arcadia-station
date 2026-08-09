import { gzipSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve("dist");
const html = await readFile(path.join(distDir, "index.html"), "utf8");
const initialMatch = html.match(/<script[^>]+src="([^"]+\.js)"/);

if (!initialMatch) throw new Error("Built index.html has no initial JavaScript entry.");

const initialPath = path.join(distDir, initialMatch[1].replace(/^\//, ""));
const initialBytes = gzipSync(await readFile(initialPath)).byteLength;
const assetNames = await readdir(path.join(distDir, "assets"));
const jsAssets = assetNames.filter((name) => name.endsWith(".js"));
const compressed = await Promise.all(
  jsAssets.map(async (name) => ({
    name,
    bytes: gzipSync(await readFile(path.join(distDir, "assets", name))).byteLength,
  })),
);
const largest = compressed.sort((a, b) => b.bytes - a.bytes)[0];
// 3D 런타임을 걷어내면서 지연 청크(three + rapier)가 사라졌다. 이제 가장 큰 청크는
// 초기 진입 번들 자체다. 예산을 그 자리에 맞춰 조여 둬야 무거운 것이 다시 들어올 때 걸린다.
const initialBudget = 180 * 1024;
const lazyChunkBudget = 220 * 1024;

console.log(
  `Initial JS: ${(initialBytes / 1024).toFixed(1)} KiB gzip / ${initialBudget / 1024} KiB budget`,
);
console.log(
  `Largest JS: ${largest.name} ${(largest.bytes / 1024).toFixed(1)} KiB gzip / ${lazyChunkBudget / 1024} KiB budget`,
);

if (initialBytes > initialBudget || largest.bytes > lazyChunkBudget) {
  process.exitCode = 1;
}
