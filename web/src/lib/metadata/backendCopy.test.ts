import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkBackendHealth,
  copyImageMetadataViaBackend,
  DEFAULT_BACKEND_URL,
  loadBackendUrl,
  saveBackendUrl,
} from "./backendCopy";

describe("backendCopy client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads and saves backend URL", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    });
    saveBackendUrl("http://127.0.0.1:9999");
    expect(loadBackendUrl()).toBe("http://127.0.0.1:9999");
    saveBackendUrl(DEFAULT_BACKEND_URL);
  });

  it("checkBackendHealth returns ok when gexiv2 available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          version: "0.1.1",
          gexiv2: { available: true, backend: "copy-img-meta", path: "/bin/copy-img-meta" },
        }),
      }),
    );

    const health = await checkBackendHealth(DEFAULT_BACKEND_URL);
    expect(health.ok).toBe(true);
    expect(health.gexiv2?.backend).toBe("copy-img-meta");
  });

  it("checkBackendHealth reports offline on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Failed to fetch")),
    );

    const health = await checkBackendHealth(DEFAULT_BACKEND_URL);
    expect(health.ok).toBe(false);
    expect(health.status).toBe("offline");
  });

  it("copyImageMetadataViaBackend posts multipart and reads headers", async () => {
    const body = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get(name: string) {
            const map: Record<string, string> = {
              "Content-Disposition": 'attachment; filename="out-meta.jpg"',
              "X-Output-Make": "OPPO",
              "X-Output-Model": "Find X8",
              "X-Output-Exif-Count": "12",
              "X-Source-Field-Count": "20",
              "X-Backend-Used": "copy-img-meta",
            };
            return map[name] ?? null;
          },
        },
        arrayBuffer: async () => body.buffer,
      }),
    );

    const dest = new File([body], "live.jpg", { type: "image/jpeg" });
    const source = new File([body], "ref.heic", { type: "image/heic" });
    const result = await copyImageMetadataViaBackend(dest, source, { excludeXmp: true }, DEFAULT_BACKEND_URL);

    expect(result.bytes).toEqual(body);
    expect(result.outputMake).toBe("OPPO");
    expect(result.outputModel).toBe("Find X8");
    expect(result.outputExifCount).toBe(12);
    expect(result.downloadName).toBe("out-meta.jpg");
    expect(result.backendUsed).toBe("copy-img-meta");

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_BACKEND_URL}/api/copy-metadata`,
      expect.objectContaining({ method: "POST" }),
    );
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("exclude_xmp")).toBe("true");
  });
});
