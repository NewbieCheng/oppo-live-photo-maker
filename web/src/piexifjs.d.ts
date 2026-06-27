declare module "piexifjs" {
  export interface IExif {
    "0th"?: Record<number, unknown>;
    Exif?: Record<number, unknown>;
    GPS?: Record<number, unknown>;
    Interop?: Record<number, unknown>;
    "1st"?: Record<number, unknown>;
    thumbnail?: unknown;
  }

  export const ImageIFD: Record<string, number>;
  export const ExifIFD: Record<string, number>;
  export const GPSIFD: Record<string, number>;

  export function load(dataUrl: string): IExif;
  export function dump(exifObj: IExif): string;
  export function insert(exifStr: string, dataUrl: string): string;
}
