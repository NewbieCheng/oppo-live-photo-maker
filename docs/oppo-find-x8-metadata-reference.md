# OPPO Find X8 Ultra 元数据参考与修改建议

> 更新：2026-06-28  
> 样本设备：OPPO Find X8 Ultra  
> 实测文件：`test_PHOTO/IMG20260626213341.heic`、`test_PHOTO/IMG20260627124108.jpg`  
> 关联文档：[metadata-copy-analysis.md](./metadata-copy-analysis.md)

本文档记录 OPPO 原片实测元数据分类、MakerNote 私有字段说明、与 `oppo-live-photo-maker` 当前实现的差异，以及 EXIF/XMP 写入与编辑的修改建议。

---

## 1. 样本概览

| 文件 | 格式 | 大小 | EXIF | XMP | IPTC | 推荐用途 |
|------|------|------|------|-----|------|----------|
| `IMG20260626213341.heic` | HEIC | 3.83 MB | 完整 | 无 | 无 | **copy 源**（机型、MakerNote、UserComment） |
| `IMG20260627124108.jpg` | JPEG | 13.5 MB | 完整 | MotionPhoto 完整 | 无 | **原生实况参考**（XMP 结构标准） |

---

## 2. EXIF 分类详表

### 2.1 IFD0（图像基本信息）

| 字段 | HEIC 值 | JPG 值 | 说明 |
|------|---------|--------|------|
| ImageWidth / ImageLength | 3072 × 4096 | 3072 × 4096 | 分辨率 |
| Make | OPPO | OPPO | 厂商 |
| Model | OPPO Find X8 Ultra | OPPO Find X8 Ultra | 机型（水印机型名依赖此字段 + MakerNotes） |
| Orientation | top, left | top, left | 正常竖屏 |
| DateTime | 2026:06:26 21:33:41 | 2026:06:27 12:41:08 | 文件修改时间 |
| YCbCrPositioning | Centered | Centered | ColorOS 水印敏感 |
| XResolution / YResolution | 72 dpi | 72 dpi | 显示分辨率 |

### 2.2 ExifIFD（拍摄参数）

| 字段 | HEIC | JPG | 说明 |
|------|------|-----|------|
| DateTimeOriginal | 2026:06:26 21:33:41 | 2026:06:27 12:41:08 | 实际拍摄时间 |
| OffsetTimeOriginal | +08:00 | +08:00 | 时区偏移 |
| SubSecTimeOriginal | 606 | 963 | 亚秒精度 |
| ExposureTime | 1/46 s | 1/33 s | 快门 |
| FNumber | F1.8 | F1.8 | 光圈 |
| ISOSpeedRatings | 3200 | 3200 | ISO |
| ExposureBiasValue | +1/3 EV | +1/3 EV | 曝光补偿 |
| FocalLength | 8.7 mm | 8.7 mm | 物理焦距 |
| FocalLengthIn35mmFilm | 23 mm | 23 mm | 等效焦距 |
| LensModel | OPPO Find X8 Ultra back camera … f/1.8 | 同左 | 镜头信息 |
| MeteringMode | Center weighted average | 同左 | 测光模式 |
| WhiteBalance | Auto | Auto | 白平衡 |
| Flash | No, compulsory | No, compulsory | 未闪光 |
| LightSource | — | D65 | JPG 含日光标记 |
| ExposureProgram / Mode | Auto | Auto | 自动曝光 |
| DigitalZoomRatio | 0.0 | 0.0 | 未数码变焦 |
| SceneType / CaptureType | Directly photographed / Standard | 同左 | 场景类型 |
| ColorSpace | sRGB | sRGB | 色彩空间 |
| PixelX/YDimension | 0 / 0 | 3072 / 4096 | HEIC 可能未填像素尺寸 |

### 2.3 Interop IFD（ColorOS 水印关键）

| 字段 | HEIC | JPG | 说明 |
|------|------|-----|------|
| InteropIndex | 可能缺失 | R98 | DCF 互操作索引，copy 后需补全 |
| InteropVersion | 可能缺失 | 0100 | 互操作版本 |

### 2.4 UserComment（OPPO 识别）

| 文件 | 值 | 说明 |
|------|-----|------|
| HEIC | `oplus_9127854112` | 设备原生 ID，copy 时应保留 |
| JPG 实况 | `oplus_8601468960` | 设备原生 ID |
| mux 兜底 | `Oplus_8388608` | 工具合成时使用，与设备 ID 不同 |

### 2.5 MakerNote（OPPO JSON 私有字段）

MakerNote 为 JSON 字符串，字段随固件/场景变化。Find X8 样本常见键：

| 键 | HEIC 示例 | JPG 示例 | 推测含义 |
|----|-----------|----------|----------|
| `Pi` | "0" | "0" | 处理标识 |
| `tmc` | "0" | "0" | 时间相关计数 |
| `cvtm` | "144" | "16" | 色彩/转换时间 |
| `nightFlag` / `nightMode` | "-1" | "-1" | 夜景模式 |
| `iso` | "15798" | "17197" | 内部 ISO 计算（≠ EXIF ISO） |
| `exp` | "0" | "0" | 曝光算法状态 |
| `fType` | "61" | "61" | 帧/格式类型 |
| `bkMode` | "0" | "0" | 背景模式 |
| `aideblur` | "0" | "0" | AI 防抖 |
| `aisState` | "8" | "8" | AIS 稳像状态 |
| `isAISD` | "0" | "0" | AISD 开关 |
| `hdrFusion` | "0" | "0" | HDR 合成 |
| `hdrStat` | "2" | "2" | HDR 状态 |
| `lightUp` | "1" | "1" | 提亮 |
| `algo` | ["69,86,78,87,16,19,84"] | 同左 | 算法 ID 列表 |
| `filter` | ":-1" | ":-1" | 滤镜 |
| `asdOut` / `apsAsdOut` / `clsOut` | 数组 | 同左 | 场景检测输出 |

**编辑建议**：MakerNote 为二进制块，不建议 JSON 字段级写回；应通过 segment transplant 或 `-MakerNotes:All<=源` 整包复制。

### 2.6 ExifByteOrder

| 文件 | 字节序 | 说明 |
|------|--------|------|
| OPPO 原生 JPG 实况 | **II**（Little-endian） | ColorOS 水印解析敏感 |
| ExifTool WASM copy 输出 | 常为 **MM** | 需强制 `-api ByteOrder=II` 或 segment realign |

---

## 3. XMP 分类详表（原生实况 JPG）

原生实况 `IMG20260627124108.jpg` 的 XMP 结构：

```
XMP Packet
├── hdrgm:Version = 1.0                    (Ultra HDR 增益图)
├── GCamera:MotionPhoto = 1
├── GCamera:MotionPhotoVersion = 1
├── GCamera:MotionPhotoPresentationTimestampUs = 1213099
├── OpCamera:MotionPhotoOwner = oplus
├── OpCamera:OLivePhotoVersion = 2
├── OpCamera:VideoLength = 7035300
├── OpCamera:MotionPhotoPrimaryPresentationTimestampUs = 1213099
└── Container:Directory (Seq)
    ├── [1] Primary   image/jpeg  Length=0
    ├── [2] GainMap   image/jpeg  Length=469317
    └── [3] MotionPhoto video/mp4 Length=7761252
```

**要点**：

- 原生 **不含** `GCamera:MicroVideo` / `MicroVideoOffset`（与 live-photo-conv / output2 路径不同）
- 原生 **不含** APP2 MPF 段
- `GCamera:MotionPhotoPresentationTimestampUs` 与 `OpCamera:MotionPhotoPrimaryPresentationTimestampUs` **相同**（1213099 微秒）
- `OpCamera:VideoLength`（7035300）与 Container MotionPhoto Item Length（7761252）统计口径可能不同（含/不含 padding）

### 3.1 GCamera 命名空间

| 标签 | 原生值 | 用途 |
|------|--------|------|
| MotionPhoto | 1 | 标识动态照片 |
| MotionPhotoVersion | 1 | 版本 |
| MotionPhotoPresentationTimestampUs | 1213099 | 封面帧时间点（微秒） |

### 3.2 OpCamera 命名空间（OPPO 私有）

| 标签 | 原生值 | 用途 |
|------|--------|------|
| MotionPhotoOwner | oplus | OPPO 厂商标记 |
| OLivePhotoVersion | 2 | O Live Photo 版本 |
| VideoLength | 7035300 | 嵌入视频长度 |
| MotionPhotoPrimaryPresentationTimestampUs | 1213099 | 与 GCamera 时间戳一致 |
| MotionPhotoFeatureFlag | 1 | 功能标志（工具默认写入） |

### 3.3 Container 命名空间

| Item | Mime | Semantic | Length |
|------|------|----------|--------|
| 1 | image/jpeg | Primary | 0 |
| 2 | image/jpeg | GainMap | 469317 |
| 3 | video/mp4 | MotionPhoto | 7761252 |

### 3.4 hdrgm 命名空间（Ultra HDR）

| 标签 | 值 | 说明 |
|------|-----|------|
| Version | 1.0 | HDR 增益图版本；无 GainMap 时可省略 |

---

## 4. 当前工具 vs OPPO 原生差异

| 字段/行为 | OPPO 原生 | motionPhotoXmp (旧) | muxer.ts (旧) |
|-----------|-----------|----------------------|---------------|
| GCamera MicroVideo | 无 | 有 (compat) | 无 |
| Container GainMap | 有 | 无 | 无 |
| hdrgm:Version | 有 | 无 | 无 |
| APP2 MPF | 无 | 剥离 | 写入 |
| PresentationTimestampUs | GCamera=OpCamera | GCamera=ts/1000 分裂 | 一致 |
| UserComment | oplus_* | copy 保留 / mux 强制 Oplus_8388608 | 强制 Oplus_8388608 |
| ExifByteOrder | II | 部分 MM | II |

---

## 5. 修改建议（写入策略）

### 5.1 EXIF

1. **copy 路径**：保留源 `UserComment`（`oplus_*`）与二进制 MakerNotes
2. **mux 路径**：有 reference 源时继承源 UserComment；否则 `Oplus_8388608` 兜底
3. **字节序**：所有 ExifTool 写入 `-api ByteOrder=II`
4. **补全字段**：InteropIndex/Version、YCbCrPositioning、ExifImageWidth/Height、OffsetTimeOriginal
5. **MakerNote**：只读展示 + 整包复制，不做 JSON 字段级写回

### 5.2 XMP（双模式）

| 模式 | 适用场景 | 写入内容 |
|------|----------|----------|
| **native**（默认） | 对齐 Find X8 原片 | GCamera MotionPhoto + OpCamera + Container(Primary[+GainMap]+MotionPhoto)；可选 hdrgm；无 MicroVideo、无 MPF |
| **compat** | live-photo-conv / output2 / 旧设备 | 额外写 MicroVideo + MicroVideoOffset |

**同步规则**：

- Container MotionPhoto Item Length = OpCamera:VideoLength = MP4 尾部字节数
- compat 模式下 MicroVideoOffset 同上
- GCamera 与 OpCamera PresentationTimestampUs 使用同一微秒值

### 5.3 可编辑字段（UI/API）

| 分组 | 字段 |
|------|------|
| OpCamera XMP | MotionPhotoOwner, OLivePhotoVersion, VideoLength, MotionPhotoFeatureFlag, MotionPhotoPrimaryPresentationTimestampUs |
| GCamera XMP | MotionPhoto, MotionPhotoVersion, MotionPhotoPresentationTimestampUs；compat 下 MicroVideo/MicroVideoOffset |
| Container | GainMap Length, MotionPhoto Length |
| hdrgm | Version |
| OPPO EXIF | UserComment, InteropIndex/Version, YCbCrPositioning, OffsetTimeOriginal |
| MakerNote | 只读 JSON 展示 +「从源复制」 |

---

## 6. 验收清单

- [ ] 编辑 UserComment 为 `oplus_9127854112` 后可写入
- [ ] 编辑 OpCamera:VideoLength 后与 MP4 尾部一致
- [ ] native 模式 XMP 含 Container 三段（有 GainMap 时）
- [ ] ColorOS 水印：Make/Model 正确（II + Interop + MakerNotes）
- [ ] GCamera 与 OpCamera 时间戳一致

---

## 7. 参考命令

```bash
# 读取完整元数据
F:/msys64/ucrt64/bin/exiv2.exe -pa test_PHOTO/IMG20260627124108.jpg

# 本仓库 ExifTool 快速对比
tools/exiftool/exiftool.exe -ExifByteOrder -Make -Model -UserComment -MicroVideoOffset -VideoLength -Trailer file.jpg
```

---

## 附录：修订记录

| 日期 | 内容 |
|------|------|
| 2026-06-28 | 初版：Find X8 双样本实测、MakerNote 字段表、工具差异、修改建议 |
