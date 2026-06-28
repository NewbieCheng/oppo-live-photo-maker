/** Cover pixel source when building a live photo. */
export type CoverMode = "videoFrame" | "referenceImage";

export type MotionPhotoXmpMode = "native" | "compat";

export interface XmpMetadataBundle {
  gcamera: Record<string, string>;
  opcamera: Record<string, string>;
  container: {
    gainMapLength?: string;
    videoLength?: string;
  };
  hdrgm: {
    version?: string;
  };
  mode: MotionPhotoXmpMode;
}

/** Editable native metadata transplanted onto the output JPEG. */
export interface NativeMetadataBundle {
  exif: Record<string, string>;
  iptc: Record<string, string>;
  xmp?: XmpMetadataBundle;
  /** Read-only MakerNote JSON preview (not written field-by-field). */
  makerNoteJson?: string;
  presentationTimestampUs?: number;
  presentationTimestampUserSet?: boolean;
}

export interface PresentationOptions {
  coverMode: CoverMode;
  coverTime: number;
  start: number;
  referenceTimestampUs?: number;
  userOverrideUs?: number;
  userSet?: boolean;
}

export function emptyXmpBundle(): XmpMetadataBundle {
  return {
    gcamera: {},
    opcamera: {},
    container: {},
    hdrgm: {},
    mode: "native",
  };
}
