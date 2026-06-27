import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { copyImgMeta } from "./copyImgMeta.js";
import { getTagStats } from "./exiftoolCli.js";
import { getBackendHealth, VERSION } from "./health.js";
import { warmupExiv2 } from "./exiv2Module.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 28471;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function safeFilename(name: string | undefined, fallback: string): string {
  const base = (name ?? fallback).replace(/\\/g, "/").split("/").pop()?.trim() ?? fallback;
  return base.replace(/[^\w.\- ()[\]]+/g, "_") || fallback;
}

function outputMetaName(destName: string): string {
  const ext = path.extname(destName) || ".jpg";
  const stem = path.basename(destName, ext) || "output";
  return `${stem}-meta${ext}`;
}

function parseBoolField(value: unknown): boolean {
  if (value === true || value === "true" || value === "1") return true;
  return false;
}

function muxViaPython(coverPath: string, videoPath: string, outputPath: string): void {
  const script =
    "from pathlib import Path; from oppo_live_photo.muxer import write_oppo_motionphoto; " +
    `write_oppo_motionphoto(Path(${JSON.stringify(coverPath)}), Path(${JSON.stringify(videoPath)}), Path(${JSON.stringify(outputPath)}))`;
  const result = spawnSync("python", ["-c", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Python mux failed");
  }
}

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ],
    exposedHeaders: [
      "X-Source-Make",
      "X-Source-Model",
      "X-Output-Make",
      "X-Output-Model",
      "X-Output-Exif-Count",
      "X-Source-Field-Count",
      "X-Backend",
      "X-Backend-Used",
      "X-ColorOS-Warning",
    ],
  });

  await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024 } });

  app.get("/api/health", async () => getBackendHealth());

  app.post("/api/copy-metadata", async (request, reply) => {
    const health = await getBackendHealth();
    if (!health.gexiv2.available) {
      return reply.status(503).send({
        detail: "Backend unavailable: exiv2-wasm failed to load and exiftool not found.",
      });
    }

    const parts = request.parts();
    let excludeExif = false;
    let excludeXmp = false;
    let excludeIptc = false;
    let source: { buffer: Buffer; filename: string } | null = null;
    let dest: { buffer: Buffer; filename: string } | null = null;

    for await (const part of parts) {
      if (part.type === "field") {
        const v = part.value;
        if (part.fieldname === "exclude_exif") excludeExif = parseBoolField(v);
        if (part.fieldname === "exclude_xmp") excludeXmp = parseBoolField(v);
        if (part.fieldname === "exclude_iptc") excludeIptc = parseBoolField(v);
      } else if (part.type === "file") {
        const chunks: Buffer[] = [];
        if (part.file) {
          for await (const chunk of part.file) chunks.push(chunk);
        }
        const entry = {
          buffer: Buffer.concat(chunks),
          filename: safeFilename(part.filename, `${part.fieldname}.jpg`),
        };
        if (part.fieldname === "source") source = entry;
        if (part.fieldname === "dest") dest = entry;
      }
    }

    if (!source || !dest) {
      return reply.status(400).send({ detail: "Missing source or dest upload" });
    }

    const sourceStats = getTagStats(new Uint8Array(source.buffer));
    let result: Awaited<ReturnType<typeof copyImgMeta>>;
    try {
      result = await copyImgMeta(
        new Uint8Array(source.buffer),
        new Uint8Array(dest.buffer),
        source.filename,
        { excludeExif, excludeXmp, excludeIptc },
      );
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }

    const outputStats = getTagStats(result.bytes);
    const outName = outputMetaName(dest.filename);
    const healthBackend = health.gexiv2.backend ?? result.backendUsed;

    reply
      .header("Content-Disposition", `attachment; filename="${outName}"`)
      .header("X-Backend", healthBackend)
      .header("X-Backend-Used", result.backendUsed)
      .header("X-Source-Make", sourceStats.make)
      .header("X-Source-Model", sourceStats.model)
      .header("X-Output-Make", outputStats.make)
      .header("X-Output-Model", outputStats.model)
      .header("X-Output-Exif-Count", String(outputStats.exifCount))
      .header("X-Source-Field-Count", String(sourceStats.fieldCount));

    if (result.colorOsIssues.length > 0) {
      reply.header("X-ColorOS-Warning", result.colorOsIssues.join("; "));
    }

    return reply.type("image/jpeg").send(Buffer.from(result.bytes));
  });

  app.post("/api/mux-live-photo", async (request, reply) => {
    const parts = request.parts();
    let image: { buffer: Buffer; filename: string } | null = null;
    let video: { buffer: Buffer; filename: string } | null = null;

    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        if (part.file) {
          for await (const chunk of part.file) chunks.push(chunk);
        }
        const entry = {
          buffer: Buffer.concat(chunks),
          filename: safeFilename(part.filename, `${part.fieldname}.bin`),
        };
        if (part.fieldname === "image") image = entry;
        if (part.fieldname === "video") video = entry;
      }
    }

    if (!image || !video) {
      return reply.status(400).send({ detail: "Missing image or video upload" });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oppo-mux-"));
    const coverPath = path.join(tmpDir, image.filename);
    const videoPath = path.join(tmpDir, video.filename);
    const stem = path.basename(image.filename, path.extname(image.filename)) || "live";
    const outPath = path.join(tmpDir, `${stem}.live.jpg`);
    fs.writeFileSync(coverPath, image.buffer);
    fs.writeFileSync(videoPath, video.buffer);

    try {
      muxViaPython(coverPath, videoPath, outPath);
      const body = fs.readFileSync(outPath);
      return reply
        .header("Content-Disposition", `attachment; filename="${stem}.live.jpg"`)
        .type("image/jpeg")
        .send(body);
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  return app;
}

async function main() {
  const host = process.env.OPPO_BACKEND_HOST ?? DEFAULT_HOST;
  const port = Number(process.env.OPPO_BACKEND_PORT ?? DEFAULT_PORT);
  await warmupExiv2();
  const app = await buildServer();
  await app.listen({ host, port });
  console.log(`OPPO Live Photo backend v${VERSION} http://${host}:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
