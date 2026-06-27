/** Cover pixel source when building a live photo. */
export type CoverMode = "videoFrame" | "referenceImage";

/** Editable native metadata transplanted onto the output JPEG. */
export interface NativeMetadataBundle {
  exif: Record<string, string>;
  iptc: Record<string, string>;
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
