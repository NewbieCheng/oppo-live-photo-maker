# OPPO Live Photo Maker

把任意视频转换成 OPPO 手机相册识别的「实况图片」（MotionPhoto）。

支持：
- **单视频精修**：可视化预览，拖动选 3 秒片段起点和封面静态帧
- **批量转换**：拖一堆视频进去，一键全转
- **高级参数**：分辨率、CRF、码率（默认值即可，懒得调可以不管）

## 安装依赖

需要这两个外部命令行工具，**必须在 PATH 里**：

| 工具 | 下载 |
|---|---|
| ffmpeg + ffprobe | https://ffmpeg.org/download.html |
| exiftool | https://exiftool.org（Windows 版下载后把 `exiftool(-k).exe` 改名为 `exiftool.exe`，放进 PATH 目录）|

验证：

```cmd
ffmpeg -version
exiftool -ver
```

## 用法

### 图形界面

```cmd
python -m src.gui
```

**单视频 Tab**：
1. 点 `Open Video...` 选视频
2. 播放预览，移动到想要的位置点 `Set Start Here` 选片段起点
3. 再移动到想要的封面位置点 `Set Cover Here`
4. 点 `Export Live Photo`
5. 默认输出到 `<视频名>.live.jpg`

**批量 Tab**：拖文件进列表 → 点 `Run Batch`。

### 命令行

```cmd
python -m src.cli VIDEO.mp4
python -m src.cli VIDEO.mp4 -o out.jpg --start 5 --duration 3 --cover-time 5.5
```

完整参数：

```text
--start S        片段起点（秒），默认 0
--duration S     片段长度（秒），默认 3
--cover-time S   封面帧时间，默认与 --start 一致
--long-edge N    输出长边像素，默认 1920
--crf N          x264 CRF（越小越精细），默认 23
--audio-kbps N   AAC 码率，默认 128
```

## 传输到手机

转出的 `.live.jpg` 通过 **USB / 蓝牙 / OPPO 互传 / 微信原图** 传到手机。

放进 `DCIM/Camera/` 让相册扫描。**不要走会压缩的通道**（普通微信图片、QQ 图片），否则元数据被剥。

## 项目结构

```
src/
  __init__.py
  cli.py            命令行入口
  gui.py            PySide6 GUI
  muxer.py          OPPO MotionPhoto 文件结构编码
  ffmpeg_utils.py   ffmpeg / ffprobe 调用
exiftool_oppo.config  自定义 XMP 命名空间（OpCamera / Container）
```

## 它是怎么工作的

OPPO 实况图片 = JPEG + 末尾追加 MP4，加上一组 XMP 元数据 + MPF (Multi-Picture Format) APP2 段。

关键 XMP 字段（缺一不可）：

- `GCamera:MotionPhoto=1` / `MotionPhotoVersion=1`
- `OpCamera:MotionPhotoOwner=oplus`
- `OpCamera:OLivePhotoVersion=2`
- `OpCamera:MotionPhotoFeatureFlag=1`
- `OpCamera:VideoLength=<视频字节数>`
- `Container:Directory` 包含 Primary JPEG + MotionPhoto MP4 两段
- EXIF `UserComment=Oplus_8388608`
- MPF `NumberOfImages=1`，`MPImageType=Baseline MP Primary`

## 协议

MIT。

## 致谢

OPPO 实况格式通过对比真机 (Find X7 Ultra) 拍摄样本和手机自己生成的 MotionPhoto 文件逆向得出。**未与 OPPO 官方关联**。
