# OPPO Live Photo Maker

[![CI](https://github.com/Young-Spark/oppo-live-photo-maker/actions/workflows/ci.yml/badge.svg)](https://github.com/Young-Spark/oppo-live-photo-maker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)

把任意视频转换成 OPPO 手机相册识别的「实况图片」（MotionPhoto）。

> 🌐 **[在线版（推荐）→ Young-Spark.github.io/oppo-live-photo-maker](https://young-spark.github.io/oppo-live-photo-maker/)**
>
> 浏览器内完成，零安装、零上传，视频不会离开你的设备。
> 需要支持 WebCodecs API 的现代浏览器：**Chrome / Edge 94+** 或 **Safari 16.4+** 或 **Firefox 130+**。
> 旧浏览器或服务器端处理需求请用下方桌面版 / CLI。

## 桌面版

支持：

- **单视频精修**：可视化预览，拖动选片段起点和封面静态帧
- **批量转换**：拖一堆视频进去，一键全转，带进度条和停止按钮
- **CLI**：可脚本化，便于集成到其他流程
- **跨平台**：Windows / macOS / Linux 都能跑（前提是装好 ffmpeg + exiftool）

## 安装

### 1. 外部依赖

需要这两个命令行工具，**必须在 PATH 里**：

| 工具 | 下载 |
|---|---|
| `ffmpeg` + `ffprobe` | https://ffmpeg.org/download.html |
| `exiftool` | https://exiftool.org（Windows 版下载后把 `exiftool(-k).exe` 改名为 `exiftool.exe`，放进 PATH 目录） |

验证：

```cmd
ffmpeg -version
exiftool -ver
```

### 2. Python 包

```cmd
pip install git+https://github.com/Young-Spark/oppo-live-photo-maker.git
```

或本地开发：

```cmd
git clone https://github.com/Young-Spark/oppo-live-photo-maker.git
cd oppo-live-photo-maker
pip install -e ".[dev]"
```

### 3. Windows 单文件 EXE（可选）

不想装 Python 的用户：在 [Releases](https://github.com/Young-Spark/oppo-live-photo-maker/releases) 下载 `OppoLivePhotoMaker.exe`，双击运行。**仍需自行安装 ffmpeg / exiftool 并加入 PATH。**

## 用法

### 图形界面

```cmd
oppo-live-gui
```

或在仓库根目录直接运行：

```cmd
python main.py
```

**单视频 Tab**：

1. 点「打开视频...」选视频
2. 播放预览，移动到想要的位置点「此处设为起点」
3. 再移动到想要的封面位置点「此处设为封面」
4. 点「导出实况图」
5. 默认输出到 `<视频名>.live.jpg`

**批量 Tab**：拖文件进列表 → 点「开始批量转换」。失败会在末尾汇总，不会逐个弹窗。

### 命令行

```cmd
oppo-live VIDEO.mp4
oppo-live VIDEO.mp4 -o out.jpg --start 5 --duration 3 --cover-time 5.5
```

完整参数：

```text
--start S        片段起点（秒），默认 0
--duration S     片段长度（秒），默认 3
--cover-time S   封面帧时间，默认与 --start 一致
--long-edge N    输出长边像素，默认 1920
--crf N          x264 CRF（越小越精细），默认 23
--audio-kbps N   AAC 码率，默认 128
--preset NAME    x264 preset，默认 fast
-q, --quiet      静默模式
-V, --version    版本号
```

## 传输到手机

转出的 `.live.jpg` 通过 **USB / 蓝牙 / OPPO 互传 / 微信原图** 传到手机。

放进 `DCIM/Camera/` 让相册扫描。**不要走会压缩的通道**（普通微信图片、QQ 图片），否则元数据被剥。

## 它是怎么工作的

OPPO 实况图片 = JPEG + 末尾追加 MP4，加上一组 XMP 元数据 + MPF（Multi-Picture Format）APP2 段。

关键 XMP 字段（缺一不可）：

- `GCamera:MotionPhoto=1` / `MotionPhotoVersion=1`
- `OpCamera:MotionPhotoOwner=oplus`
- `OpCamera:OLivePhotoVersion=2`
- `OpCamera:MotionPhotoFeatureFlag=1`
- `OpCamera:VideoLength=<视频字节数>`
- `Container:Directory` 包含 Primary JPEG + MotionPhoto MP4 两段
- EXIF `UserComment=Oplus_8388608`
- MPF `NumberOfImages=1`，`MPImageType=Baseline MP Primary`

## 项目结构

```
src/oppo_live_photo/
  __init__.py
  cli.py            命令行入口（installed as `oppo-live`）
  gui.py            PySide6 GUI（installed as `oppo-live-gui`）
  muxer.py          OPPO MotionPhoto 文件结构编码
  ffmpeg_utils.py   ffmpeg / ffprobe 调用
  data/
    exiftool_oppo.config  自定义 XMP 命名空间（OpCamera / Container）
tests/              单元测试 + e2e 烟测
.github/workflows/  CI（ruff + pytest）+ Release（PyInstaller）
main.py             直接运行入口（PyInstaller 打包用）
build.bat           Windows 打 EXE 脚本
```

## 常见问题

**Q：相册里看不到实况标识？**
- 确认走的是不压缩通道，QQ / 微信普通图片会剥光元数据
- 文件需放进 `DCIM/Camera/` 等被相册索引的目录
- 部分老固件可能不识别，已知 ColorOS 14+ 工作正常

**Q：转出来的视频上下颠倒 / 旋转错误？**
- 提 issue 时附上 `ffprobe -v error -show_streams VIDEO` 的输出，旋转元数据是已知雷区

**Q：批量转一半某个失败了怎么办？**
- 其他文件继续转完，失败的会在结束后汇总列出，不会卡死

## 兼容机型

已验证：Find X7 Ultra（ColorOS 14）

如果你在其他 OPPO / OnePlus / realme 机型上验证成功（或失败），欢迎在 [Issue 区](https://github.com/Young-Spark/oppo-live-photo-maker/issues) 反馈，我会更新这里的列表。

## 开发

```cmd
pip install -e ".[dev]"
ruff check src tests
pytest
```

CI 在每次 push / PR 自动跑 ruff + pytest（Linux / macOS / Windows × Python 3.9 / 3.11 / 3.12）。

## 协议

[MIT](LICENSE)。

## 网页版（web/）

`web/` 子目录是同一格式的纯前端 TypeScript + Vue3 实现，部署在 GitHub Pages 上：

- `web/src/lib/muxer.ts` — 用纯 JS 写 OPPO MotionPhoto 字节结构（**不依赖 exiftool**）
- `web/src/lib/webcodecs.ts` — 基于 [mediabunny](https://mediabunny.dev/) + WebCodecs API 的硬件加速解码 / 编码 / 封装
- `web/src/App.vue` — 简洁单页 UI

浏览器要求：**Chrome / Edge 94+** 或 **Safari 16.4+** 或 **Firefox 130+**（必须支持 WebCodecs API）。

本地开发：

```cmd
cd web
npm install
npm run dev
```

测试：

```cmd
npm test
```

构建（GitHub Pages 部署用）会在 push 到 `web/**` 时由 `.github/workflows/pages.yml` 自动触发。

## 致谢

- [mediabunny](https://mediabunny.dev/) — 网页版用到的 WebCodecs 封装库（MPL-2.0）
- 逆向参考了 Google MotionPhoto / GContainer 公开规范，对比 Find X7 Ultra 真机样本得出。

## 免责

OPPO 实况格式通过对比真机（Find X7 Ultra）拍摄样本和手机自己生成的 MotionPhoto 文件**逆向得出**。本项目**未经 OPPO/欢太/Oplus 授权**，与官方无任何关联。`OpCamera` 等命名空间仅用于格式互操作。

## 致谢

逆向过程参考了 Google MotionPhoto / GContainer 公开规范。
