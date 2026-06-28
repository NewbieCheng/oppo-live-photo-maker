/** Map editable metadata bundle fields to ExifTool `-Tag=value` write args. */
export interface MetadataWriteBundle {
    exif: Record<string, string>;
    iptc: Record<string, string>;
    presentationTimestampUs?: number;
}
/** Build ExifTool write arguments for in-place metadata editing. */
export declare function bundleToExiftoolWriteArgs(bundle: MetadataWriteBundle, dirtyKeys?: Set<string>): string[];
