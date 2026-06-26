/**
 * Hardware-accelerated decode/encode pipeline using mediabunny + WebCodecs.
 *
 * mediabunny handles all the low-level demux/decode/transform/encode/mux
 * plumbing; the browser's WebCodecs API provides hardware-accelerated codecs
 * where the platform supports them.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canDecode,
  canEncode,
  type InputVideoTrack,
} from "mediabunny";

export class WebCodecsUnsupported extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WebCodecsUnsupported";
  }
}

// ---------- Capability probing -------------------------------------------

export function hasWebCodecsApi(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).VideoDecoder === "function" &&
    typeof (window as any).VideoEncoder === "function" &&
    typeof (window as any).AudioDecoder === "function" &&
    typeof (window as any).AudioEncoder === "function"
  );
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  codec: string;
}

/**
 * Probe a video file: returns metadata + a verdict on whether the WebCodecs
 * pipeline can run end-to-end (decode the input + encode H.264 output).
 *
 * Throws when the input itself cannot be parsed.
 */
export async function probeAndCheck(file: Blob): Promise<{
  info: VideoInfo;
  supported: boolean;
  reason?: string;
}> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error("文件中没有视频轨");
    }
    const codec = await track.getCodec();
    if (!codec) {
      return {
        info: {
          duration: 0,
          width: await track.getCodedWidth(),
          height: await track.getCodedHeight(),
          hasAudio: false,
          codec: "",
        },
        supported: false,
        reason: "无法识别视频编码",
      };
    }
    const audioTrack = await input.getPrimaryAudioTrack();
    const info: VideoInfo = {
      duration: await input.computeDuration(),
      width: await track.getDisplayWidth(),
      height: await track.getDisplayHeight(),
      hasAudio: !!audioTrack,
      codec,
    };
    if (!hasWebCodecsApi()) {
      return { info, supported: false, reason: "浏览器不支持 WebCodecs API" };
    }
    const decodable = await canDecode(codec);
    if (!decodable) {
      return { info, supported: false, reason: `浏览器不支持解码 ${codec}` };
    }
    const encodable = await canEncode("avc");
    if (!encodable) {
      return { info, supported: false, reason: "浏览器不支持 H.264 编码" };
    }
    return { info, supported: true };
  } finally {
    await input.dispose();
  }
}

// ---------- Cover extraction (single frame -> JPEG) ----------------------

export async function extractCoverWebCodecs(
  file: Blob,
  options: { timestamp: number; longEdge: number },
): Promise<Uint8Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let track: InputVideoTrack | null;
  try {
    track = await input.getPrimaryVideoTrack();
    if (!track) throw new WebCodecsUnsupported("No video track");

    const codec = await track.getCodec();
    if (!codec || !(await canDecode(codec))) {
      throw new WebCodecsUnsupported(`Cannot decode codec ${codec ?? "unknown"}`);
    }

    const srcW = await track.getDisplayWidth();
    const srcH = await track.getDisplayHeight();
    const longEdge = options.longEdge;
    const isLandscape = srcW >= srcH;
    const outW = isLandscape ? longEdge : Math.max(2, Math.round(((srcW * longEdge) / srcH) / 2) * 2);
    const outH = isLandscape ? Math.max(2, Math.round(((srcH * longEdge) / srcW) / 2) * 2) : longEdge;

    const sink = new CanvasSink(track, { width: outW, height: outH, fit: "fill" });
    // mp4 edit lists often shift the first PTS off zero. Clamp the request to
    // the track's actual first timestamp so getCanvas never returns null on
    // an "in-range" request.
    const firstTs = await track.getFirstTimestamp();
    const safeTs = Math.max(options.timestamp, firstTs);
    let wrapped = await sink.getCanvas(safeTs);
    if (!wrapped) {
      // Last-ditch: walk the iterator and grab whatever the first decodable
      // frame turns out to be.
      for await (const w of sink.canvases()) {
        wrapped = w;
        break;
      }
    }
    if (!wrapped) throw new Error("Could not extract a frame at the requested timestamp");

    const canvas = wrapped.canvas;
    let blob: Blob;
    if (canvas instanceof OffscreenCanvas) {
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    } else {
      blob = await new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
          "image/jpeg",
          0.92,
        );
      });
    }
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    await input.dispose();
  }
}

// ---------- Clip transcoding (start..start+duration -> H.264 MP4) --------

export interface ClipOptions {
  start: number;
  duration: number;
  longEdge: number;
  bitrate?: number; // bits/sec; defaults to QUALITY_HIGH
  audioKbps?: number;
  hasAudio?: boolean;
  onProgress?: (ratio: number) => void;
  onDiscarded?: (reasons: string[]) => void;
}

export async function transcodeClipWebCodecs(
  file: Blob,
  opts: ClipOptions,
): Promise<Uint8Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new WebCodecsUnsupported("No video track");
    const codec = await track.getCodec();
    if (!codec || !(await canDecode(codec))) {
      throw new WebCodecsUnsupported(`Cannot decode codec ${codec ?? "unknown"}`);
    }
    if (!(await canEncode("avc"))) {
      throw new WebCodecsUnsupported("Browser cannot encode H.264");
    }

    const srcW = await track.getDisplayWidth();
    const srcH = await track.getDisplayHeight();
    const longEdge = opts.longEdge;
    const isLandscape = srcW >= srcH;
    const targetW = isLandscape ? longEdge : Math.round(((srcW * longEdge) / srcH) / 2) * 2;
    const targetH = isLandscape ? Math.round(((srcH * longEdge) / srcW) / 2) * 2 : longEdge;

    // Authoritative audio probe via mediabunny.
    const audioTrack = await input.getPrimaryAudioTrack();
    const wantAudio = opts.hasAudio !== false && !!audioTrack;

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });

    const firstTs = await track.getFirstTimestamp();
    const trimStart = Math.max(opts.start, firstTs);
    const trimEnd = trimStart + opts.duration;

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: "avc",
        width: targetW,
        height: targetH,
        fit: "cover",
        bitrate: opts.bitrate ?? QUALITY_HIGH,
      },
      audio: !wantAudio
        ? { discard: true }
        : {
            codec: "aac",
            bitrate: (opts.audioKbps ?? 128) * 1000,
          },
      trim: {
        start: trimStart,
        end: trimEnd,
      },
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((t) => t.reason).join(", ");
      throw new WebCodecsUnsupported(`Conversion not valid: ${reasons}`);
    }
    if (conversion.discardedTracks.length && opts.onDiscarded) {
      opts.onDiscarded(
        conversion.discardedTracks.map((t) => `${t.track.type}: ${t.reason}`),
      );
    }

    if (opts.onProgress) {
      conversion.onProgress = (p) => opts.onProgress!(p);
    }
    await conversion.execute();

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Output buffer empty");
    return new Uint8Array(buffer);
  } finally {
    await input.dispose();
  }
}
