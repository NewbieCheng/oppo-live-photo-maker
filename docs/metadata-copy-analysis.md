# 元信息复制与机型水印 — 分析文档

> 更新：2026-06-27  
> 对照项目：[live-photo-conv](https://github.com/wszqkzqk/live-photo-conv)  
> 本文档用于记录 CLI 对比结论、推荐操作步骤与后续排查清单。

---

## 1. 问题背景

在 OPPO 手机相册中为照片添加 **Hasselblad 水印** 时：

- **曝光参数**（如 `23mm f/1.8 1/46s ISO3200`）可能正常显示  
- **机型名称** 却显示为占位符 **「Model Name」**，并可能出现 **「Failed to obtain photo details」**

这说明：**标准 EXIF 拍摄参数已写入**，但 ColorOS 原生元数据解析器对**整包 EXIF/XMP 结构**校验失败，未采用 IFD0 中的 Make/Model。

---

## 2. 三类元信息（不要混为一谈）

| 用途 | 依赖字段 | 由谁写入 |
|------|----------|----------|
| **动态照片识别 / 长按播放** | OpCamera XMP、GCamera MotionPhoto、MPF、`UserComment` | 功能一 **mux** |
| **水印曝光行** | `FNumber`、`ExposureTime`、`ISO`、`FocalLength` 等 ExifIFD | 功能二 **copy** |
| **水印机型名** | IFD0 `Make`/`Model` + 可能的 MakerNotes；需 **II 字节序** 与完整 Interop | 功能二 **copy**（GExiv2/ExifTool） |

`copy-img-meta` / 功能二 **不负责** MotionPhoto 识别所需的 OpCamera XMP（OPPO 预设会 **排除 XMP**）。

---

## 3. 推荐操作步骤

> **重要：网页版 vs 桌面版不一样**  
> - **网页功能一**：只能上传**视频**，封面是程序从视频里**自动截一帧**，不能自己选 JPG。  
> - **live-photo-conv / 命令行**：可以指定「封面 JPG + 视频」分开传入。

### 3.1 网页版（当前在线工具）— 只有视频时这么做

你需要准备 **2 个文件**：

| 编号 | 是什么 | 举例 |
|------|--------|------|
| **A. OPPO 原片** | 手机**普通拍照**（别开实况），用来提供机型等信息 | `IMG20260626213341.heic` |
| **B. 你的视频** | 要做成实况的那段视频 | `VID_xxx.mp4` |

**步骤（先功能一，再功能二）：**

```
① 功能一：只选视频 B → 生成并下载  video.live.jpg
                    （封面是视频里截的，还没有 OPPO 机型信息）

② 功能二：
   源图 = A（OPPO 原片）
   目标图 = ① 刚下的 video.live.jpg
   预设 = OPPO 推荐（排除 XMP）
   → 下载  video.live-meta.jpg

③ 手机：只拷 video.live-meta.jpg，在相册里测播放 + 水印机型
```

功能一**不会**让你选封面文件；封面在内部从视频生成，你看不见也改不了。

---

### 3.2 桌面版（最稳，对齐 live-photo-conv FAQ）

需要 **3 个文件**：OPPO 原片、**单独一张封面 JPG**、视频。

```
厂商原片 (source)
    │
    ▼  copy-img-meta --exclude-xmp  或 网页功能二
普通封面 cover.jpg（不是 live.jpg）
    │
    ▼  live-photo-conv --make  或  oppo-live --reference-image
output.live.jpg
    │
    ▼  拷到手机
```

#### 网页版（若你有一张「普通 JPG 封面」）

若除了视频外，还有一张**单独的 JPG**（例如 OPPO 同场景拍的静图、或自己导出的帧）：

1. **功能二**：源 = OPPO 原片，目标 = 这张 **普通 JPG** → 下载 `cover-meta.jpg`  
2. **功能一仍无法使用 cover-meta.jpg**（只能视频）→ 须改用下面 **3.2 命令行** 把 `cover-meta.jpg` 和视频合成。

#### 桌面 live-photo-conv + copy-img-meta

```bash
# 1. 复制元数据到封面（排除 XMP）
copy-img-meta --exclude-xmp /path/to/oppo_source.jpg /path/to/cover.jpg

# 2. 合成动态照片
live-photo-conv --make --image /path/to/cover.jpg --video /path/to/video.mp4 --live-photo /path/to/output.jpg

# 3. 若可识别但无法播放
live-photo-conv --repair -p /path/to/output.jpg
```

#### 本仓库 Python CLI

```bash
oppo-live VIDEO.mp4 --reference-image oppo_source.heic --cover-mode reference
```

---

### 3.3 备选：网页「先 mux 再 copy 到 live.jpg」

```
功能一 → live.jpg → 功能二（源 HEIC + 目标 live.jpg）→ *-meta.jpg
```

风险：

- 需切分 JPEG / MP4 尾部再拼回  
- **排除 XMP** 时旧 `VideoLength` 可能与真实 MP4 尾部不一致  
- ExifTool WASM 可能写出 **MM 大端** EXIF，与 OPPO 原片 **II 小端** 不一致  

仅在无法先 copy 到封面时使用；优先 3.1。

---

### 3.4 功能二 UI 选项说明

| 选项 | 对应 CLI | OPPO 预设 | 说明 |
|------|----------|-----------|------|
| 排除 EXIF | `--exclude-exif` | 关 | 关 = 复制 Make/Model/ISO 等 |
| 排除 XMP | `--exclude-xmp` | **开** | 保留目标 MotionPhoto XMP，不覆盖 |
| 排除 IPTC | `--exclude-iptc` | 关 | 一般保留 |

**机型在 EXIF，不在 XMP**；排除 XMP 不会直接删掉 Make/Model，但会保留 mux 写入的（可能过时的）`VideoLength`。

---

## 4. 实测对比：`output2.jpg` vs `999999999.live-meta (8).jpg`

使用本仓库自带 ExifTool（2026-06-27 实测）：

| 项目 | output2.jpg（live-photo-conv，手机有机型） | live-meta (8).jpg（网页 copy 到 live） |
|------|---------------------------------------------|----------------------------------------|
| 文件大小 | 5.7 MB | 2.7 MB |
| 分辨率 | 1254×1254 | 1920×1440 |
| **Make / Model** | OPPO / OPPO Find X8 Ultra | **相同** |
| 曝光参数 | 8.7mm f/1.8 1/46s ISO3200 | **相同** |
| MakerNotes | 329 bytes | **329 bytes（二进制相同）** |
| UserComment | `oplus_9127854112` | **相同** |
| **ExifByteOrder** | **Little-endian (II)** | **Big-endian (MM)** ⚠️ |
| InteropIndex / OffsetTimeOriginal | 有 | **缺失** ⚠️ |
| YCbCrPositioning | Centered | **缺失** |
| 动态照片 XMP | MicroVideo + MicroVideoOffset | OpCamera + MPF |
| XMP 视频大小 | 5607009 = 实际尾部 ✅ | VideoLength **2387235** vs 尾部 **44277** ❌ |
| APP2 MPF | 无 | 有 |

**结论：**

1. 机型 **文本已写入** 两个文件；差异在 **EXIF 容器格式** 与 **XMP/视频长度一致性**。  
2. ColorOS 水印更可能因 **整包解析失败** 显示 “Model Name”，而非 Make/Model 未复制。  
3. live-photo-conv 路径保留 **II 字节序** 与 **MicroVideo XMP 与尾部一致**。

---

## 5. ExifTool 对比命令（后续分析复用）

Windows 下使用本仓库内置 ExifTool：

```text
F:\Dev\Desktop-Projects\livephoto\oppo-live-photo-maker\tools\exiftool\exiftool.exe
```

以下将 `EXIFTOOL` 换为上述路径，`A.jpg` / `B.jpg` 换为待对比文件。

### 5.1 快速看机型与字节序

```bash
EXIFTOOL -ExifByteOrder -Make -Model -LensModel -FNumber -FocalLength -ExposureTime -ISO -UserComment A.jpg B.jpg
```

### 5.2 完整 EXIF 差异

```bash
EXIFTOOL -G1 -s -EXIF:All A.jpg > exif_a.txt
EXIFTOOL -G1 -s -EXIF:All B.jpg > exif_b.txt
# 再用 diff / Compare-Object 对比
```

### 5.3 动态照片 XMP

```bash
EXIFTOOL -G1 -a -MicroVideo -MicroVideoOffset -MotionPhoto -MotionPhotoOwner -OLivePhotoVersion -VideoLength -MPF:All A.jpg B.jpg
```

### 5.4 文件尾部视频大小

```bash
EXIFTOOL -Trailer -FileSize A.jpg B.jpg
```

尾部字节数应等于 XMP 中的 `MicroVideoOffset` / `OpCamera:VideoLength`（或 Container Item Length 中的 MotionPhoto 项）。

### 5.5 MakerNotes 二进制对比

```bash
EXIFTOOL -b -MakerNotes A.jpg > mn_a.bin
EXIFTOOL -b -MakerNotes B.jpg > mn_b.bin
# fc /b mn_a.bin mn_b.bin
```

### 5.6 JPEG APP 段（Python 片段扫描）

见本文档附录 A，或运行：

```bash
python scripts/analyze_jpeg_metadata.py path/to/file.jpg
```

（若脚本尚未添加，可用文档附录 A 内联 Python。）

---

## 6. copy-img-meta 写入方式对照

### live-photo-conv（GExiv2）

```text
open_path(源) → 可选 clear_exif/xmp/iptc → save_file(目标)
```

- 不改像素，整块复制 EXIF/XMP/IPTC  
- 无 Make/Model 专项逻辑  

### 网页功能二（ExifTool WASM）

```text
TagsFromFile 源 -All:all [--XMP:all] -o 输出 目标
→ ensureIfd0MakeModel（piexif 强制 IFD0 Make/Model）
→ 若目标为 live.jpg：切 JPEG / 写 EXIF / 拼回 MP4
```

### Python `metadata.copy_img_meta`

与 ExifTool CLI 相同参数，使用系统 `exiftool`。

---

## 7. 故障排查清单

| 现象 | 可能原因 | 检查 |
|------|----------|------|
| 只有曝光参数，无机型 | EXIF **MM**、缺 Interop；或 XMP VideoLength 与尾部不一致 | `-ExifByteOrder`、`-VideoLength`、`-Trailer` |
| Failed to obtain photo details | 同上 + live.jpg 结构损坏 | 对比 output2 与 meta 的 XMP/尾部 |
| 动态照片不能播放 | VideoLength 错误；MP4 尾部丢失 | 文件大小、`-Trailer` |
| 完全无元数据 | 用了原 live 文件而非 `*-meta.jpg` | 下载文件名 |
| HEIC 源问题 | 跨格式复制，MakerNotes 可能不完整 | 换 **原生 JPG** 源对比 |

---

## 8. 已知待改进项（代码）

| 优先级 | 项 | 说明 |
|--------|-----|------|
| P0 | ExifTool 输出 **II 小端** | `-api ByteOrder=II` 或复制后转换 |
| P0 | copy 后 **同步 VideoLength** | 按实际 MP4 尾部更新 OpCamera/Container |
| P1 | 补全 Interop / OffsetTime | 从源图复制或写入默认值 |
| P2 | UI 引导「先 copy 封面再 mux」 | 减少 live.jpg 作目标 |
| P2 | 一键流水线 | 功能二结果直接进功能一 |

---

## 附录 A：JPEG APP 段扫描（Python）

```python
import struct
from pathlib import Path

def scan_jpeg(path: str) -> None:
    b = Path(path).read_bytes()
    print(f"=== {path} ({len(b)} bytes) ===")
    i = 2
    while i < len(b) - 1:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m == 0xDA:
            print(f"  @{i}: SOS")
            break
        if m == 0xD9:
            print(f"  @{i}: EOI")
            break
        if m in (0x01,) or (0xD0 <= m <= 0xD7):
            i += 2
            continue
        ln = struct.unpack(">H", b[i + 2 : i + 4])[0]
        name = f"APP{m - 0xE0}" if 0xE0 <= m <= 0xEF else f"M{m:02X}"
        sig = b[i + 4 : i + 12].hex()
        print(f"  @{i}: {name} len={ln} sig={sig}")
        i += 2 + ln
    for j in range(len(b) - 2, -1, -1):
        if b[j] == 0xFF and b[j + 1] == 0xD9:
            print(f"  last EOI @{j + 2}, MP4 tail {len(b) - j - 2} bytes")
            break

# 用法：
# scan_jpeg(r"C:\Users\...\output2.jpg")
# scan_jpeg(r"C:\Users\...\999999999.live-meta (8).jpg")
```

---

## 附录 B：参考链接

- [live-photo-conv README-zh — Android 厂商分裂 FAQ](https://github.com/wszqkzqk/live-photo-conv/blob/main/README-zh.md)
- [live-photo-conv copyimgmeta.vala](https://github.com/wszqkzqk/live-photo-conv/blob/main/src/copyimgmeta.vala)
- 本仓库：`web/src/lib/metadata/copyContract.ts`、`exiftoolCopy.ts`、`muxer.ts`

---

## 附录 C：修订记录

| 日期 | 内容 |
|------|------|
| 2026-06-27 | 初版：output2 vs live-meta CLI 对比、推荐步骤、排查清单 |
| 2026-06-27 | 修正：区分网页功能一（仅视频）与桌面「封面+视频」流程 |
