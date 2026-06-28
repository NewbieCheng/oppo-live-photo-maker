"""GUI for OPPO Live Photo Maker (PySide6) - 中文界面."""
# SPDX-License-Identifier: MIT
from __future__ import annotations

import sys
import tempfile
import traceback
from pathlib import Path
from typing import TypedDict

from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtCore import Qt, QUrl, Signal
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget

from . import ffmpeg_utils, gui_styles, metadata, muxer

STEP_LABELS = ["原生图", "视频", "元数据", "导出"]

# Metadata field groups mirroring web/src/lib/metadata/fields.ts
METADATA_GROUPS: list[tuple[str, str, list[tuple[str, str]], bool]] = [
    ("camera", "相机", [
        ("EXIF:Make", "品牌 (Make)"),
        ("EXIF:Model", "型号 (Model)"),
        ("EXIF:Software", "软件 (Software)"),
        ("EXIF:LensModel", "镜头 (LensModel)"),
        ("EXIF:Orientation", "方向 (Orientation)"),
    ], False),
    ("exposure", "曝光", [
        ("EXIF:FNumber", "光圈 (FNumber)"),
        ("EXIF:ExposureTime", "快门 (ExposureTime)"),
        ("EXIF:ISO", "ISO"),
        ("EXIF:FocalLength", "焦距 (FocalLength)"),
        ("EXIF:Flash", "闪光灯 (Flash)"),
        ("EXIF:WhiteBalance", "白平衡 (WhiteBalance)"),
    ], False),
    ("datetime", "时间", [
        ("EXIF:DateTimeOriginal", "拍摄时间"),
        ("EXIF:CreateDate", "创建时间"),
        ("EXIF:ModifyDate", "修改时间"),
        ("EXIF:OffsetTimeOriginal", "时区偏移"),
    ], False),
    ("location", "位置", [
        ("Composite:GPSLatitude", "纬度 (GPSLatitude)"),
        ("Composite:GPSLongitude", "经度 (GPSLongitude)"),
        ("Composite:GPSAltitude", "海拔 (GPSAltitude)"),
        ("EXIF:GPSDateStamp", "GPS 日期"),
    ], False),
    ("iptc", "IPTC", [
        ("IPTC:Keywords", "关键词"),
        ("IPTC:Caption-Abstract", "说明"),
        ("IPTC:CopyrightNotice", "版权"),
    ], True),
]

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".heic", ".heif", ".png", ".webp"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}


class ConvertParams(TypedDict, total=False):
    start: float
    duration: float
    cover_time: float
    long_edge: int
    crf: int
    audio_kbps: int
    preset: str
    reference_image: str
    cover_mode: str
    video_mode: str
    metadata_overrides: metadata.NativeMetadataBundle
    presentation_timestamp_us: int


# ---------- Worker thread ---------------------------------------------------

class ConvertWorker(QtCore.QObject):
    """后台线程执行单次转换。"""
    progress = Signal(str)
    finished = Signal(Path)
    failed = Signal(str)

    def __init__(self, video: Path, output: Path, params: ConvertParams):
        super().__init__()
        self.video = video
        self.output = output
        self.params = params
        self._cancel = False
        self._result_detail: dict[str, float | int] = {}

    def cancel(self) -> None:
        self._cancel = True

    @QtCore.Slot()
    def run(self) -> None:
        try:
            with tempfile.TemporaryDirectory(prefix="oppo-live-") as td:
                td_path = Path(td)
                cover = td_path / "cover.jpg"
                clip = td_path / "clip.mp4"
                p = self.params

                try:
                    info = ffmpeg_utils.probe(self.video)
                except Exception:
                    info = None

                rotation = info.rotation if info else 0

                if self._cancel:
                    raise RuntimeError("已取消")

                reference = Path(p["reference_image"]) if p.get("reference_image") else None
                cover_mode = p.get("cover_mode", "reference")
                video_mode = p.get("video_mode", "full")

                if cover_mode == "reference" and reference is not None:
                    self.progress.emit("正在导出参考图封面（live-photo-conv）...")
                    ffmpeg_utils.export_main_image(reference, cover)
                else:
                    self.progress.emit("正在抽取封面帧...")
                    ffmpeg_utils.extract_cover(
                        self.video, cover,
                        timestamp=p["cover_time"],
                        target_long_edge=p["long_edge"],
                        rotation=rotation,
                    )
                if self._cancel:
                    raise RuntimeError("已取消")

                if video_mode == "full":
                    self.progress.emit("正在嵌入原视频（流复制）...")
                    ffmpeg_utils.prepare_video_for_mux(
                        self.video, clip, mode="full", start=p["start"],
                    )
                else:
                    self.progress.emit("正在编码视频片段...")
                    ffmpeg_utils.prepare_video_for_mux(
                        self.video, clip,
                        mode="clip",
                        start=p["start"],
                        duration=p["duration"],
                        target_long_edge=p["long_edge"],
                        crf=p["crf"],
                        audio_bitrate_k=p.get("audio_kbps", 128),
                        preset=p.get("preset", "fast"),
                        has_audio=(info.has_audio if info else None),
                        rotation=rotation,
                    )
                if self._cancel:
                    raise RuntimeError("已取消")

                self.progress.emit("正在合成 OPPO 实况图...")
                muxer.write_oppo_motionphoto(
                    cover,
                    clip,
                    self.output,
                    presentation_timestamp_us=p.get("presentation_timestamp_us", 0),
                    reference_jpg=reference,
                    metadata_overrides=p.get("metadata_overrides"),
                    cover_mode=cover_mode,
                )
                clip_bytes = clip.stat().st_size if clip.is_file() else 0
                self._result_detail = {
                    "clip_bytes": clip_bytes,
                    "clip_duration": p.get("duration", 0),
                    "video_mode": video_mode,
                }
            self.finished.emit(self.output)
        except Exception as e:
            tb = traceback.format_exc()
            self.failed.emit(f"{e}\n\n{tb}")


# ---------- Shared widgets ---------------------------------------------------

class VideoListWidget(QtWidgets.QListWidget):
    """QListWidget that accepts video file drops."""

    files_dropped = Signal(list)

    def __init__(self, parent: QtWidgets.QWidget | None = None):
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setSelectionMode(QtWidgets.QAbstractItemView.ExtendedSelection)
        self.setDragDropMode(QtWidgets.QAbstractItemView.DropOnly)

    def dragEnterEvent(self, e: QtGui.QDragEnterEvent) -> None:  # noqa: N802
        if e.mimeData().hasUrls():
            e.acceptProposedAction()
        else:
            super().dragEnterEvent(e)

    def dragMoveEvent(self, e: QtGui.QDragMoveEvent) -> None:  # noqa: N802
        if e.mimeData().hasUrls():
            e.acceptProposedAction()
        else:
            super().dragMoveEvent(e)

    def dropEvent(self, e: QtGui.QDropEvent) -> None:  # noqa: N802
        if not e.mimeData().hasUrls():
            super().dropEvent(e)
            return
        files: list[Path] = []
        for url in e.mimeData().urls():
            p = Path(url.toLocalFile())
            if p.is_file():
                files.append(p)
        if files:
            self.files_dropped.emit(files)
            e.acceptProposedAction()


class FileDropFrame(QtWidgets.QFrame):
    """Clickable / droppable target matching web drop-target."""

    activated = Signal()
    file_dropped = Signal(Path)

    def __init__(
        self,
        icon: str,
        title: str,
        hint: str,
        suffixes: set[str],
        parent: QtWidgets.QWidget | None = None,
    ):
        super().__init__(parent)
        self._suffixes = suffixes
        self.setObjectName("dropTarget")
        self.setCursor(Qt.PointingHandCursor)
        self.setSizePolicy(
            QtWidgets.QSizePolicy.Expanding,
            QtWidgets.QSizePolicy.Expanding,
        )
        self.setMinimumHeight(160)

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(24, 40, 24, 40)
        layout.setSpacing(8)
        layout.setAlignment(Qt.AlignCenter)

        icon_lbl = QtWidgets.QLabel(icon)
        icon_lbl.setAlignment(Qt.AlignCenter)
        icon_lbl.setStyleSheet(
            f"font-size: 28px; color: {gui_styles.TEXT_SOFT};"
        )
        title_lbl = QtWidgets.QLabel(title)
        title_lbl.setObjectName("panelTitle")
        title_lbl.setAlignment(Qt.AlignCenter)
        hint_lbl = QtWidgets.QLabel(hint)
        hint_lbl.setObjectName("emptyHint")
        hint_lbl.setAlignment(Qt.AlignCenter)
        hint_lbl.setWordWrap(True)
        layout.addWidget(icon_lbl)
        layout.addWidget(title_lbl)
        layout.addWidget(hint_lbl)

        self.setAcceptDrops(True)

    def mousePressEvent(self, e: QtGui.QMouseEvent) -> None:  # noqa: N802
        if e.button() == Qt.LeftButton:
            self.activated.emit()
        super().mousePressEvent(e)

    def dragEnterEvent(self, e: QtGui.QDragEnterEvent) -> None:  # noqa: N802
        if self._first_matching(e.mimeData()):
            e.acceptProposedAction()
        else:
            e.ignore()

    def dragMoveEvent(self, e: QtGui.QDragMoveEvent) -> None:  # noqa: N802
        if self._first_matching(e.mimeData()):
            e.acceptProposedAction()
        else:
            e.ignore()

    def dropEvent(self, e: QtGui.QDropEvent) -> None:  # noqa: N802
        path = self._first_matching(e.mimeData())
        if path:
            self.file_dropped.emit(path)
            e.acceptProposedAction()

    def _first_matching(self, mime: QtCore.QMimeData) -> Path | None:
        if not mime.hasUrls():
            return None
        for url in mime.urls():
            p = Path(url.toLocalFile())
            if p.is_file() and p.suffix.lower() in self._suffixes:
                return p
        return None


class StepIndicator(QtWidgets.QWidget):
    """Four-step track mirroring web StepIndicator.vue."""

    def __init__(self, parent: QtWidgets.QWidget | None = None):
        super().__init__(parent)
        self._current = 1
        self._dots: list[QtWidgets.QLabel] = []
        self._names: list[QtWidgets.QLabel] = []
        self._build()

    def _build(self) -> None:
        row = QtWidgets.QHBoxLayout(self)
        row.setContentsMargins(0, 4, 0, 4)
        row.setSpacing(0)

        for i, label in enumerate(STEP_LABELS):
            if i > 0:
                conn = QtWidgets.QFrame()
                conn.setObjectName("stepConnector")
                conn.setSizePolicy(
                    QtWidgets.QSizePolicy.Expanding,
                    QtWidgets.QSizePolicy.Fixed,
                )
                row.addWidget(conn, 1)

            node = QtWidgets.QVBoxLayout()
            node.setSpacing(8)
            node.setAlignment(Qt.AlignCenter)
            dot = QtWidgets.QLabel()
            dot.setObjectName("stepDot")
            dot.setAlignment(Qt.AlignCenter)
            name = QtWidgets.QLabel(label)
            name.setObjectName("stepName")
            name.setAlignment(Qt.AlignCenter)
            self._dots.append(dot)
            self._names.append(name)
            node_wrap = QtWidgets.QWidget()
            node_wrap.setLayout(node)
            node.addWidget(dot, 0, Qt.AlignHCenter)
            node.addWidget(name, 0, Qt.AlignHCenter)
            row.addWidget(node_wrap)

        self.set_current(1)

    def set_current(self, step: int) -> None:
        self._current = max(1, min(4, step))
        for i in range(4):
            idx = i + 1
            if idx == self._current:
                self._dots[i].setObjectName("stepDotActive")
                self._names[i].setObjectName("stepNameActive")
            elif idx < self._current:
                self._dots[i].setObjectName("stepDotDone")
                self._names[i].setObjectName("stepNameDone")
            else:
                self._dots[i].setObjectName("stepDot")
                self._names[i].setObjectName("stepName")
            self._dots[i].style().unpolish(self._dots[i])
            self._dots[i].style().polish(self._dots[i])
            self._names[i].style().unpolish(self._names[i])
            self._names[i].style().polish(self._names[i])


def _make_chip(text: str, *, accent: bool = False) -> QtWidgets.QLabel:
    chip = QtWidgets.QLabel(text)
    chip.setObjectName("chipAccent" if accent else "chip")
    return chip


def _wrap_scroll(content: QtWidgets.QWidget) -> QtWidgets.QScrollArea:
    scroll = QtWidgets.QScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setFrameShape(QtWidgets.QFrame.NoFrame)
    scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
    scroll.setWidget(content)
    return scroll


def _panel_frame() -> tuple[QtWidgets.QFrame, QtWidgets.QVBoxLayout]:
    frame = QtWidgets.QFrame()
    frame.setObjectName("stepPanel")
    layout = QtWidgets.QVBoxLayout(frame)
    layout.setContentsMargins(24, 24, 24, 24)
    layout.setSpacing(18)
    return frame, layout


def _build_brand_header() -> QtWidgets.QWidget:
    header = QtWidgets.QWidget()
    layout = QtWidgets.QVBoxLayout(header)
    layout.setContentsMargins(0, 0, 0, 0)
    layout.setSpacing(8)

    brand_row = QtWidgets.QHBoxLayout()
    badge = QtWidgets.QLabel("●  LIVE")
    badge.setObjectName("liveBadge")
    title = QtWidgets.QLabel("实况图制作")
    title.setObjectName("brandTitle")
    brand_row.addWidget(badge)
    brand_row.addWidget(title)
    brand_row.addStretch(1)
    layout.addLayout(brand_row)

    tagline = QtWidgets.QLabel(
        "机内原图 → 视频 → OPPO 相册可识别的 MotionPhoto · "
        "支持 HEIC/JPG 元数据解析 · "
    )
    tagline.setObjectName("tagline")
    tagline.setWordWrap(True)
    accent = QtWidgets.QLabel("全程本地处理")
    accent.setObjectName("taglineAccent")
    tag_row = QtWidgets.QHBoxLayout()
    tag_row.setContentsMargins(0, 0, 0, 0)
    tag_row.addWidget(tagline)
    tag_row.addWidget(accent)
    tag_row.addStretch(1)
    layout.addLayout(tag_row)
    return header


# ---------- Single convert tab (4-step wizard) --------------------------------

class SingleTab(QtWidgets.QWidget):
    def __init__(self):
        super().__init__()
        self.video_path: Path | None = None
        self.video_info: ffmpeg_utils.VideoInfo | None = None
        self.thread: QtCore.QThread | None = None
        self.worker: ConvertWorker | None = None
        self._cover_user_set = False
        self.reference_path: Path | None = None
        self.reference_bundle: metadata.NativeMetadataBundle | None = None
        self.metadata_edits = metadata.NativeMetadataBundle()
        self._step = 1
        self._meta_group_id = "camera"
        self._convert_running = False

        self._build_ui()
        self._update_nav()
        self._update_export_state()

    def _build_ui(self) -> None:
        root = QtWidgets.QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(12)

        self.step_indicator = StepIndicator()
        root.addWidget(self.step_indicator)

        nav = QtWidgets.QHBoxLayout()
        self.btn_prev = QtWidgets.QPushButton("← 上一步")
        self.btn_prev.clicked.connect(self._prev_step)
        self.lbl_step_nav = QtWidgets.QLabel(STEP_LABELS[0])
        self.lbl_step_nav.setObjectName("stepNavLabel")
        self.lbl_step_nav.setAlignment(Qt.AlignCenter)
        self.btn_next = QtWidgets.QPushButton("下一步 →")
        self.btn_next.clicked.connect(self._next_step)
        nav.addWidget(self.btn_prev)
        nav.addWidget(self.lbl_step_nav, 1)
        nav.addWidget(self.btn_next)
        root.addLayout(nav)

        self.stack = QtWidgets.QStackedWidget()
        self.stack.setSizePolicy(
            QtWidgets.QSizePolicy.Expanding,
            QtWidgets.QSizePolicy.Expanding,
        )
        root.addWidget(self.stack, 1)

        self._build_step_reference()
        self._build_step_video()
        self._build_step_metadata()
        self._build_step_export()

        self.stack.setCurrentIndex(0)

    # --- Step 1: 原生图 ---
    def _build_step_reference(self) -> None:
        page = QtWidgets.QWidget()
        outer = QtWidgets.QVBoxLayout(page)
        outer.setContentsMargins(0, 0, 0, 0)

        frame, layout = _panel_frame()
        title = QtWidgets.QLabel("上传机内原图")
        title.setObjectName("panelTitle")
        desc = QtWidgets.QLabel(
            "第一步：上传手机相册里的普通照片（机内直出的 JPG / HEIC 等）。"
            "工具会实时读取 Make、Model、拍摄时间、GPS 等 EXIF，并在导出时移植到实况图。"
        )
        desc.setObjectName("panelDesc")
        desc.setWordWrap(True)
        layout.addWidget(title)
        layout.addWidget(desc)

        self.ref_drop = FileDropFrame(
            "◫",
            "拖入或选择机内原图",
            "JPG · HEIC · HEIF · PNG · WebP · 不上传服务器",
            IMAGE_SUFFIXES,
        )
        self.ref_drop.activated.connect(self._pick_reference)
        self.ref_drop.file_dropped.connect(self.load_reference)
        layout.addWidget(self.ref_drop)

        self.ref_parsing = QtWidgets.QLabel("正在解析…")
        self.ref_parsing.setObjectName("sectionDesc")
        self.ref_parsing.setVisible(False)
        layout.addWidget(self.ref_parsing)

        self.ref_preview = QtWidgets.QWidget()
        ref_prev_layout = QtWidgets.QHBoxLayout(self.ref_preview)
        ref_prev_layout.setContentsMargins(0, 0, 0, 0)
        ref_prev_layout.setSpacing(20)
        self.ref_thumb = QtWidgets.QLabel()
        self.ref_thumb.setFixedSize(140, 140)
        self.ref_thumb.setAlignment(Qt.AlignCenter)
        self.ref_thumb.setStyleSheet(
            f"background: #000; border: 1px solid {gui_styles.BORDER}; "
            "border-radius: 10px;"
        )
        self.ref_thumb.setScaledContents(True)
        ref_meta = QtWidgets.QVBoxLayout()
        self.ref_name = QtWidgets.QLabel()
        self.ref_name.setObjectName("filename")
        self.ref_name.setWordWrap(True)
        self.ref_chips_row = QtWidgets.QHBoxLayout()
        self.ref_chips_row.setSpacing(6)
        self.ref_chips_widget = QtWidgets.QWidget()
        self.ref_chips_widget.setLayout(self.ref_chips_row)
        ref_actions = QtWidgets.QHBoxLayout()
        btn_change = QtWidgets.QPushButton("更换")
        btn_change.setObjectName("ghostButton")
        btn_change.clicked.connect(self._pick_reference)
        btn_remove = QtWidgets.QPushButton("移除")
        btn_remove.setObjectName("ghostButton")
        btn_remove.clicked.connect(self._clear_reference)
        ref_actions.addWidget(btn_change)
        ref_actions.addWidget(btn_remove)
        ref_actions.addStretch(1)
        ref_meta.addWidget(self.ref_name)
        ref_meta.addWidget(self.ref_chips_widget)
        ref_meta.addLayout(ref_actions)
        ref_meta.addStretch(1)
        ref_prev_layout.addWidget(self.ref_thumb)
        ref_prev_layout.addLayout(ref_meta, 1)
        self.ref_preview.setVisible(False)
        layout.addWidget(self.ref_preview)

        cover_legend = QtWidgets.QLabel("封面来源")
        cover_legend.setObjectName("fieldLabel")
        layout.addWidget(cover_legend)

        self.cover_mode_group = QtWidgets.QButtonGroup(self)
        self.mode_video_frame = self._make_mode_option(
            "视频帧", "从预览中截取静态封面", "video"
        )
        self.mode_ref_image = self._make_mode_option(
            "参考图", "原图像素 + copy-img-meta（live-photo-conv 推荐）", "reference"
        )
        self.radio_cover_video = self.mode_video_frame.findChild(QtWidgets.QRadioButton)
        self.radio_cover_ref = self.mode_ref_image.findChild(QtWidgets.QRadioButton)
        self.radio_cover_ref.setChecked(True)
        self.cover_mode_group.addButton(self.radio_cover_video)
        self.cover_mode_group.addButton(self.radio_cover_ref)
        self.radio_cover_ref.toggled.connect(self._update_export_state)
        layout.addWidget(self.mode_video_frame)
        layout.addWidget(self.mode_ref_image)
        layout.addStretch(1)

        outer.addWidget(frame)
        self.stack.addWidget(_wrap_scroll(page))

    def _make_mode_option(
        self, title: str, subtitle: str, value: str
    ) -> QtWidgets.QFrame:
        frame = QtWidgets.QFrame()
        frame.setObjectName("modeOption")
        row = QtWidgets.QHBoxLayout(frame)
        row.setContentsMargins(12, 10, 12, 10)
        radio = QtWidgets.QRadioButton()
        radio.setProperty("cover_value", value)
        copy = QtWidgets.QVBoxLayout()
        copy.setSpacing(2)
        strong = QtWidgets.QLabel(title)
        strong.setStyleSheet("font-weight: 500;")
        small = QtWidgets.QLabel(subtitle)
        small.setObjectName("emptyHint")
        copy.addWidget(strong)
        copy.addWidget(small)
        row.addWidget(radio)
        row.addLayout(copy, 1)
        radio.toggled.connect(lambda checked: self._sync_mode_frame(frame, checked))
        return frame

    def _sync_mode_frame(self, frame: QtWidgets.QFrame, checked: bool) -> None:
        if checked:
            frame.setObjectName("modeOptionSelected")
        else:
            radio = frame.findChild(QtWidgets.QRadioButton)
            disabled = radio and not radio.isEnabled()
            frame.setObjectName("modeOptionDisabled" if disabled else "modeOption")
        frame.style().unpolish(frame)
        frame.style().polish(frame)

    # --- Step 2: 视频 ---
    def _build_step_video(self) -> None:
        page = QtWidgets.QWidget()
        outer = QtWidgets.QVBoxLayout(page)
        outer.setContentsMargins(0, 0, 0, 0)

        frame, layout = _panel_frame()

        self.video_drop = FileDropFrame(
            "▷",
            "拖入视频，或点击选择",
            "MP4 · MOV · MKV · WebM · 文件不会离开本机",
            VIDEO_SUFFIXES,
        )
        self.video_drop.activated.connect(self._pick_video)
        self.video_drop.file_dropped.connect(self.load_video)
        layout.addWidget(self.video_drop)

        self.video_content = QtWidgets.QWidget()
        vc = QtWidgets.QVBoxLayout(self.video_content)
        vc.setContentsMargins(0, 0, 0, 0)
        vc.setSpacing(12)

        head = QtWidgets.QHBoxLayout()
        head_left = QtWidgets.QVBoxLayout()
        head_title = QtWidgets.QLabel("选取片段")
        head_title.setObjectName("panelTitle")
        self.lbl_meta_line = QtWidgets.QLabel()
        self.lbl_meta_line.setObjectName("metaLine")
        head_left.addWidget(head_title)
        head_left.addWidget(self.lbl_meta_line)
        btn_change_video = QtWidgets.QPushButton("换视频")
        btn_change_video.setObjectName("ghostButton")
        btn_change_video.clicked.connect(self._change_video)
        head.addLayout(head_left, 1)
        head.addWidget(btn_change_video)
        vc.addLayout(head)

        self.lbl_filename = QtWidgets.QLabel()
        self.lbl_filename.setObjectName("filename")
        self.lbl_filename.setWordWrap(True)
        vc.addWidget(self.lbl_filename)

        splitter = QtWidgets.QSplitter(Qt.Vertical)
        splitter.setChildrenCollapsible(False)

        preview_wrap = QtWidgets.QWidget()
        preview_layout = QtWidgets.QVBoxLayout(preview_wrap)
        preview_layout.setContentsMargins(0, 0, 0, 0)
        self.video_widget = QVideoWidget()
        self.video_widget.setMinimumHeight(180)
        self.video_widget.setSizePolicy(
            QtWidgets.QSizePolicy.Expanding,
            QtWidgets.QSizePolicy.Expanding,
        )
        preview_layout.addWidget(self.video_widget, 1)

        self.player = QMediaPlayer(self)
        self.audio_out = QAudioOutput(self)
        self.player.setAudioOutput(self.audio_out)
        self.player.setVideoOutput(self.video_widget)
        self.audio_out.setVolume(0.5)
        self.player.positionChanged.connect(self._on_position)
        self.player.durationChanged.connect(self._on_duration)
        self.player.errorOccurred.connect(self._on_player_error)
        self.player.mediaStatusChanged.connect(self._on_media_status)

        params_wrap = QtWidgets.QWidget()
        params_layout = QtWidgets.QVBoxLayout(params_wrap)
        params_layout.setContentsMargins(0, 0, 0, 0)
        params_layout.setSpacing(10)

        transport = QtWidgets.QHBoxLayout()
        self.lbl_pos = QtWidgets.QLabel("0.00 / 0.00 秒")
        self.lbl_pos.setObjectName("timecode")
        self.btn_set_start = QtWidgets.QPushButton("设为起点")
        self.btn_set_start.clicked.connect(self._set_start_from_preview)
        self.btn_set_cover = QtWidgets.QPushButton("设为封面")
        self.btn_set_cover.clicked.connect(self._set_cover_from_preview)
        self.btn_play = QtWidgets.QPushButton("播放")
        self.btn_play.clicked.connect(self._toggle_play)
        transport.addWidget(self.lbl_pos)
        transport.addStretch(1)
        transport.addWidget(self.btn_play)
        transport.addWidget(self.btn_set_start)
        transport.addWidget(self.btn_set_cover)
        params_layout.addLayout(transport)

        self.slider = QtWidgets.QSlider(Qt.Horizontal)
        self.slider.setRange(0, 0)
        self.slider.sliderMoved.connect(self._slider_seek)
        params_layout.addWidget(self.slider)

        form_grid = QtWidgets.QGridLayout()
        form_grid.setHorizontalSpacing(14)
        form_grid.setVerticalSpacing(10)
        self.spin_start = self._labeled_spin(
            form_grid, 0, "片段起点", QtWidgets.QDoubleSpinBox,
            suffix=" 秒", decimals=2, maximum=99999.0,
        )
        self.spin_start.valueChanged.connect(self._sync_cover_default)
        self.spin_duration = self._labeled_spin(
            form_grid, 1, "片段时长", QtWidgets.QDoubleSpinBox,
            suffix=" 秒", decimals=2, minimum=0.5, maximum=10.0, value=3.0,
        )
        self.spin_cover = self._labeled_spin(
            form_grid, 2, "封面位置", QtWidgets.QDoubleSpinBox,
            suffix=" 秒", decimals=2, maximum=99999.0,
        )
        self.spin_cover.valueChanged.connect(self._mark_cover_user_set)
        params_layout.addLayout(form_grid)

        embed_legend = QtWidgets.QLabel("视频嵌入")
        embed_legend.setObjectName("fieldLabel")
        params_layout.addWidget(embed_legend)
        self.video_mode_group = QtWidgets.QButtonGroup(self)
        self.mode_video_full = self._make_mode_option(
            "原视频", "流复制原编码（≤3s 整段，更长取前 3s）", "full"
        )
        self.mode_video_clip = self._make_mode_option(
            "重编码片段", "截取并转码短 MP4", "clip"
        )
        self.radio_video_full = self.mode_video_full.findChild(QtWidgets.QRadioButton)
        self.radio_video_clip = self.mode_video_clip.findChild(QtWidgets.QRadioButton)
        self.radio_video_full.setChecked(True)
        self.video_mode_group.addButton(self.radio_video_full)
        self.video_mode_group.addButton(self.radio_video_clip)
        self.radio_video_full.toggled.connect(self._sync_video_mode_ui)
        self.radio_video_clip.toggled.connect(self._sync_video_mode_ui)
        params_layout.addWidget(self.mode_video_full)
        params_layout.addWidget(self.mode_video_clip)

        self.adv_box = QtWidgets.QGroupBox("编码参数")
        self.adv_box.setCheckable(True)
        self.adv_box.setChecked(False)
        adv_form = QtWidgets.QFormLayout(self.adv_box)
        self.spin_long_edge = QtWidgets.QSpinBox()
        self.spin_long_edge.setRange(360, 4096)
        self.spin_long_edge.setValue(1920)
        self.spin_long_edge.setSuffix(" 像素")
        adv_form.addRow("输出长边：", self.spin_long_edge)
        self.spin_crf = QtWidgets.QSpinBox()
        self.spin_crf.setRange(14, 32)
        self.spin_crf.setValue(23)
        self.spin_crf.setToolTip("CRF 越小画质越好但文件越大")
        adv_form.addRow("视频 CRF：", self.spin_crf)
        self.spin_audio = QtWidgets.QSpinBox()
        self.spin_audio.setRange(64, 320)
        self.spin_audio.setValue(128)
        self.spin_audio.setSuffix(" kbps")
        adv_form.addRow("音频码率：", self.spin_audio)
        params_layout.addWidget(self.adv_box)

        splitter.addWidget(preview_wrap)
        splitter.addWidget(params_wrap)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)
        vc.addWidget(splitter, 1)

        self.video_content.setVisible(False)
        layout.addWidget(self.video_content)
        layout.addStretch(1)

        outer.addWidget(frame)
        self.stack.addWidget(_wrap_scroll(page))
        self._sync_video_mode_ui()

    def _labeled_spin(
        self,
        grid: QtWidgets.QGridLayout,
        row: int,
        label: str,
        cls: type,
        **kwargs,
    ):
        lbl = QtWidgets.QLabel(label)
        lbl.setObjectName("fieldLabel")
        spin = cls()
        for k, v in kwargs.items():
            if hasattr(spin, k):
                getattr(spin, f"set{k[0].upper()}{k[1:]}")(v)
        unit = QtWidgets.QLabel("秒 · 建议 ≤3" if label == "片段时长" else "")
        unit.setObjectName("emptyHint")
        grid.addWidget(lbl, row, 0)
        grid.addWidget(spin, row, 1)
        grid.addWidget(unit, row, 2)
        return spin

    # --- Step 3: 元数据 ---
    def _build_step_metadata(self) -> None:
        page = QtWidgets.QWidget()
        outer = QtWidgets.QVBoxLayout(page)
        outer.setContentsMargins(0, 0, 0, 0)

        frame, layout = _panel_frame()
        head = QtWidgets.QHBoxLayout()
        head_left = QtWidgets.QVBoxLayout()
        title = QtWidgets.QLabel("原生数据")
        title.setObjectName("panelTitle")
        desc = QtWidgets.QLabel("编辑后将写入输出 JPEG。标黄字段表示已修改。")
        desc.setObjectName("panelDesc")
        head_left.addWidget(title)
        head_left.addWidget(desc)
        btn_reload = QtWidgets.QPushButton("从参考图加载")
        btn_reload.clicked.connect(self._reload_metadata_from_reference)
        self.btn_reload_meta = btn_reload
        head.addLayout(head_left, 1)
        head.addWidget(btn_reload)
        layout.addLayout(head)

        self.meta_search = QtWidgets.QLineEdit()
        self.meta_search.setObjectName("searchInput")
        self.meta_search.setPlaceholderText("搜索 Make、GPS、DateTime…")
        self.meta_search.textChanged.connect(self._filter_meta_fields)
        layout.addWidget(self.meta_search)

        empty = QtWidgets.QLabel(
            "未上传参考图时，可手动填写；上传后会自动解析填充。"
        )
        empty.setObjectName("emptyHint")
        layout.addWidget(empty)

        meta_body = QtWidgets.QHBoxLayout()
        meta_body.setSpacing(20)
        self.meta_group_btns: dict[str, QtWidgets.QPushButton] = {}
        groups_col = QtWidgets.QVBoxLayout()
        groups_col.setSpacing(4)
        for gid, gtitle, _, _ in METADATA_GROUPS:
            btn = QtWidgets.QPushButton(gtitle)
            btn.setObjectName("groupBtn" if gid != "camera" else "groupBtnActive")
            btn.setProperty("group_id", gid)
            btn.clicked.connect(lambda _=False, g=gid: self._select_meta_group(g))
            self.meta_group_btns[gid] = btn
            groups_col.addWidget(btn)
        sys_btn = QtWidgets.QPushButton("OPPO 系统")
        sys_btn.setObjectName("groupBtn")
        sys_btn.setProperty("group_id", "system")
        sys_btn.clicked.connect(lambda: self._select_meta_group("system"))
        self.meta_group_btns["system"] = sys_btn
        groups_col.addWidget(sys_btn)
        groups_col.addStretch(1)
        meta_body.addLayout(groups_col)

        self.meta_fields_stack = QtWidgets.QStackedWidget()
        self.meta_fields: dict[str, QtWidgets.QLineEdit] = {}
        self._meta_field_keys: dict[str, tuple[str, bool]] = {}

        for gid, _, fields, is_iptc in METADATA_GROUPS:
            gw = QtWidgets.QWidget()
            gf = QtWidgets.QGridLayout(gw)
            gf.setHorizontalSpacing(12)
            gf.setVerticalSpacing(10)
            for i, (key, flabel) in enumerate(fields):
                lbl = QtWidgets.QLabel(flabel)
                lbl.setObjectName("fieldLabel")
                edit = QtWidgets.QLineEdit()
                edit.setPlaceholderText(key.split(":")[-1])
                edit.setProperty("meta_key", key)
                edit.setProperty("meta_iptc", is_iptc)
                edit.textChanged.connect(self._on_meta_edit)
                self.meta_fields[key] = edit
                self._meta_field_keys[key] = (gid, is_iptc)
                row, col = divmod(i, 2)
                gf.addWidget(lbl, row * 2, col)
                gf.addWidget(edit, row * 2 + 1, col)
            self.meta_fields_stack.addWidget(gw)

        sys_w = QtWidgets.QWidget()
        sys_f = QtWidgets.QFormLayout(sys_w)
        uc = QtWidgets.QLineEdit(metadata.OPPO_USER_COMMENT)
        uc.setReadOnly(True)
        sys_f.addRow("UserComment（OPPO 识别标记）：", uc)
        self.spin_presentation = QtWidgets.QSpinBox()
        self.spin_presentation.setRange(0, 2_000_000_000)
        self.spin_presentation.setSpecialValueText("自动计算")
        self.spin_presentation.valueChanged.connect(self._on_presentation_edit)
        sys_f.addRow("PresentationTimestampUs：", self.spin_presentation)
        hint = QtWidgets.QLabel("微秒 · 封面在片段内的偏移")
        hint.setObjectName("emptyHint")
        sys_f.addRow("", hint)
        self.meta_fields_stack.addWidget(sys_w)

        meta_body.addWidget(self.meta_fields_stack, 1)
        layout.addLayout(meta_body, 1)

        outer.addWidget(frame)
        self.stack.addWidget(_wrap_scroll(page))
        self._select_meta_group("camera")

    # --- Step 4: 导出 ---
    def _build_step_export(self) -> None:
        page = QtWidgets.QWidget()
        outer = QtWidgets.QVBoxLayout(page)
        outer.setContentsMargins(0, 0, 0, 0)

        frame, layout = _panel_frame()
        title = QtWidgets.QLabel("生成实况图")
        title.setObjectName("panelTitle")
        desc = QtWidgets.QLabel(
            "封面、视频片段与元数据将在本地合成，输出 OPPO 相册可识别的 MotionPhoto JPEG。"
        )
        desc.setObjectName("panelDesc")
        desc.setWordWrap(True)
        layout.addWidget(title)
        layout.addWidget(desc)

        out_row = QtWidgets.QHBoxLayout()
        out_lbl = QtWidgets.QLabel("输出路径：")
        out_lbl.setObjectName("fieldLabel")
        self.out_edit = QtWidgets.QLineEdit()
        self.out_edit.setPlaceholderText("留空则与源视频同目录，自动生成 .live.jpg")
        btn_browse = QtWidgets.QPushButton("…")
        btn_browse.setMaximumWidth(40)
        btn_browse.clicked.connect(self._pick_output)
        out_row.addWidget(out_lbl)
        out_row.addWidget(self.out_edit, 1)
        out_row.addWidget(btn_browse)
        layout.addLayout(out_row)

        self.btn_convert = QtWidgets.QPushButton("开始转换")
        self.btn_convert.setObjectName("primaryButton")
        self.btn_convert.clicked.connect(self._do_convert)
        layout.addWidget(self.btn_convert)

        self.export_status = QtWidgets.QLabel("")
        self.export_status.setObjectName("statusLabel")
        layout.addWidget(self.export_status)

        self.export_progress = QtWidgets.QProgressBar()
        self.export_progress.setRange(0, 0)
        self.export_progress.setVisible(False)
        layout.addWidget(self.export_progress)

        self.log_edit = QtWidgets.QTextEdit()
        self.log_edit.setObjectName("logBody")
        self.log_edit.setReadOnly(True)
        self.log_edit.setMaximumHeight(200)
        self.log_edit.setVisible(False)
        layout.addWidget(self.log_edit)

        tip = QtWidgets.QLabel(
            "用 USB、OPPO 互传或微信原图传到手机，放进 DCIM/Camera/。"
            "普通微信 / QQ 图片会剥除元数据，相册无法识别实况。"
        )
        tip.setObjectName("sectionDesc")
        tip.setWordWrap(True)
        layout.addWidget(tip)
        layout.addStretch(1)

        outer.addWidget(frame)
        self.stack.addWidget(_wrap_scroll(page))

    # --- Wizard navigation ---
    def _prev_step(self) -> None:
        if self._step > 1:
            self._step -= 1
            self._apply_step()

    def _next_step(self) -> None:
        if self._step < 4:
            self._step += 1
            self._apply_step()

    def _apply_step(self) -> None:
        self.stack.setCurrentIndex(self._step - 1)
        self.step_indicator.set_current(self._step)
        self.lbl_step_nav.setText(STEP_LABELS[self._step - 1])
        self._update_nav()

    def _update_nav(self) -> None:
        self.btn_prev.setEnabled(self._step > 1 and not self._convert_running)
        self.btn_next.setEnabled(self._step < 4 and not self._convert_running)

    def _can_convert(self) -> bool:
        if not self.video_path or not self.video_info:
            return False
        return not (self.radio_cover_ref.isChecked() and not self.reference_path)

    def _update_export_state(self) -> None:
        ref_ok = bool(self.reference_path)
        self.radio_cover_ref.setEnabled(ref_ok)
        self.mode_ref_image.setObjectName(
            "modeOptionDisabled" if not ref_ok else "modeOption"
        )
        if not ref_ok and self.radio_cover_ref.isChecked():
            self.radio_cover_video.setChecked(True)
        self._sync_mode_frame(self.mode_video_frame, self.radio_cover_video.isChecked())
        self._sync_mode_frame(self.mode_ref_image, self.radio_cover_ref.isChecked())
        self.btn_convert.setEnabled(self._can_convert() and not self._convert_running)
        self.btn_reload_meta.setEnabled(bool(self.reference_bundle))

    # --- Reference ---
    def _pick_reference(self) -> None:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "选择参考原生图", "",
            "图片 (*.jpg *.jpeg *.heic *.heif *.png *.webp *.JPG *.JPEG *.HEIC *.HEIF);;所有文件 (*.*)"
        )
        if path:
            self.load_reference(Path(path))

    def load_reference(self, path: Path) -> None:
        self.ref_drop.setVisible(False)
        self.ref_preview.setVisible(False)
        self.ref_parsing.setVisible(True)
        self.ref_parsing.setText(f"正在解析 {path.name} …")
        QtWidgets.QApplication.processEvents()
        try:
            bundle = metadata.parse_reference_image(path)
        except Exception as e:
            self.ref_parsing.setVisible(False)
            self.ref_drop.setVisible(True)
            QtWidgets.QMessageBox.critical(self, "读取参考图失败", str(e))
            return
        self.reference_path = path
        self.reference_bundle = bundle
        self.metadata_edits = metadata.NativeMetadataBundle()
        self.ref_parsing.setVisible(False)
        self.ref_preview.setVisible(True)
        self.ref_name.setText(path.name)
        self._populate_meta_fields(bundle)
        self._update_ref_chips(path, bundle)
        pix = QtGui.QPixmap(str(path))
        if not pix.isNull():
            self.ref_thumb.setPixmap(
                pix.scaled(140, 140, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            )
        else:
            self.ref_thumb.setText("预览")
        self.radio_cover_ref.setChecked(True)
        self._sync_mode_frame(self.mode_ref_image, True)
        self._sync_mode_frame(self.mode_video_frame, False)
        self._update_export_state()

    def _sync_video_mode_ui(self, _checked: bool = False) -> None:
        clip_mode = self.radio_video_clip.isChecked()
        for spin in (self.spin_start, self.spin_duration, self.spin_cover):
            spin.setEnabled(clip_mode)
        self.adv_box.setEnabled(clip_mode)
        if not clip_mode and self.video_info:
            self.spin_duration.setValue(min(10.0, self.video_info.duration))

    def _update_ref_chips(
        self, path: Path, bundle: metadata.NativeMetadataBundle
    ) -> None:
        while self.ref_chips_row.count():
            item = self.ref_chips_row.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        fmt = path.suffix.lstrip(".").upper() or "IMG"
        field_count = len(bundle.exif) + len(bundle.iptc)
        self.ref_chips_row.addWidget(_make_chip(fmt))
        self.ref_chips_row.addWidget(_make_chip(f"{field_count} 项元数据"))
        make = bundle.exif.get("EXIF:Make", "")
        model = bundle.exif.get("EXIF:Model", "")
        if make:
            self.ref_chips_row.addWidget(_make_chip(make, accent=True))
        if model:
            self.ref_chips_row.addWidget(_make_chip(model, accent=True))
        dt = bundle.exif.get("EXIF:DateTimeOriginal", "")
        if dt:
            self.ref_chips_row.addWidget(_make_chip(dt))
        if bundle.exif.get("Composite:GPSLatitude"):
            self.ref_chips_row.addWidget(_make_chip("GPS"))
        self.ref_chips_row.addStretch(1)

    def _clear_reference(self) -> None:
        self.reference_path = None
        self.reference_bundle = None
        self.metadata_edits = metadata.NativeMetadataBundle()
        self.ref_preview.setVisible(False)
        self.ref_drop.setVisible(True)
        self.ref_thumb.clear()
        for edit in self.meta_fields.values():
            edit.blockSignals(True)
            edit.clear()
            edit.setObjectName("")
            edit.blockSignals(False)
        self.radio_cover_video.setChecked(True)
        self._update_export_state()

    # --- Video ---
    def _pick_video(self) -> None:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "选择视频", "",
            "视频文件 (*.mp4 *.mov *.mkv *.avi *.webm *.MP4 *.MOV);;所有文件 (*.*)"
        )
        if path:
            self.load_video(Path(path))

    def load_video(self, path: Path) -> None:
        try:
            info = ffmpeg_utils.probe(path)
        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "读取视频信息失败", str(e))
            return
        self.video_path = path
        self.video_info = info
        self._cover_user_set = False
        self.video_drop.setVisible(False)
        self.video_content.setVisible(True)
        self.lbl_filename.setText(path.name)
        try:
            self.lbl_meta_line.setText(
                f"{info.display_width}×{info.display_height} · "
                f"{info.codec.upper() if info.codec else '?'}"
            )
            self.player.setSource(QUrl.fromLocalFile(str(path.resolve())))
            self.spin_start.setRange(0.0, max(0.0, info.duration - 0.5))
            self.spin_cover.setRange(0.0, max(0.0, info.duration))
            self.spin_start.setValue(0.0)
            self.spin_cover.setValue(0.0)
            self.spin_duration.setMaximum(min(10.0, info.duration))
            if info.duration < 3.0:
                self.spin_duration.setValue(max(0.5, info.duration))
            else:
                self.spin_duration.setValue(3.0)
            self.radio_video_full.setChecked(True)
            self.export_status.setText(
                f"已加载 {path.name}（{info.display_width}×{info.display_height}，"
                f"{info.duration:.2f} 秒）"
            )
            self._update_export_state()
            self._sync_video_mode_ui()
        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "加载视频预览失败", str(e))
            self._change_video()

    def _on_player_error(self, error: QMediaPlayer.Error, message: str = "") -> None:
        if error == QMediaPlayer.NoError:
            return
        hint = message or str(error)
        if self.video_info and self.video_info.codec in ("hevc", "h265"):
            hint += "\n\nHEVC/H.265 在部分 Windows 预览中不可用，但仍可用 ffmpeg 转码导出实况图。"
        self.export_status.setText(f"预览播放失败：{hint}")

    def _on_media_status(self, status: QMediaPlayer.MediaStatus) -> None:
        if status == QMediaPlayer.InvalidMedia:
            self.export_status.setText(
                "无法预览此视频编码；片段参数已就绪，可直接导出（转码由 ffmpeg 处理）。"
            )

    def _change_video(self) -> None:
        self.player.stop()
        self.video_path = None
        self.video_info = None
        self.video_content.setVisible(False)
        self.video_drop.setVisible(True)
        self._update_export_state()

    def _on_duration(self, ms: int) -> None:
        self.slider.setRange(0, ms)

    def _on_position(self, ms: int) -> None:
        self.slider.setValue(ms)
        dur = self.player.duration() / 1000.0
        self.lbl_pos.setText(f"{ms / 1000:.2f} / {dur:.2f} 秒")

    def _slider_seek(self, ms: int) -> None:
        self.player.setPosition(ms)

    def _toggle_play(self) -> None:
        if self.player.playbackState() == QMediaPlayer.PlayingState:
            self.player.pause()
            self.btn_play.setText("播放")
        else:
            self.player.play()
            self.btn_play.setText("暂停")

    def _set_start_from_preview(self) -> None:
        t = self.player.position() / 1000.0
        self.spin_start.setValue(t)

    def _set_cover_from_preview(self) -> None:
        t = self.player.position() / 1000.0
        self._cover_user_set = True
        self.spin_cover.setValue(t)

    def _mark_cover_user_set(self) -> None:
        if abs(self.spin_cover.value() - self.spin_start.value()) > 1e-3:
            self._cover_user_set = True

    def _sync_cover_default(self, v: float) -> None:
        if not self._cover_user_set:
            self.spin_cover.setValue(v)

    # --- Metadata ---
    def _select_meta_group(self, gid: str) -> None:
        self._meta_group_id = gid
        idx = len(METADATA_GROUPS) if gid == "system" else next(
            i for i, (g, _, _, _) in enumerate(METADATA_GROUPS) if g == gid
        )
        self.meta_fields_stack.setCurrentIndex(idx)
        for g, btn in self.meta_group_btns.items():
            btn.setObjectName("groupBtnActive" if g == gid else "groupBtn")
            btn.style().unpolish(btn)
            btn.style().polish(btn)
        self._filter_meta_fields()

    def _filter_meta_fields(self) -> None:
        q = self.meta_search.text().strip().lower()
        for key, edit in self.meta_fields.items():
            gid, _ = self._meta_field_keys[key]
            if gid != self._meta_group_id:
                continue
            label = edit.property("meta_key") or key
            visible = not q or q in key.lower() or q in label.lower()
            edit.setVisible(visible)
            parent = edit.parentWidget()
            if parent:
                for child in parent.findChildren(QtWidgets.QLabel):
                    if child.objectName() == "fieldLabel":
                        fl = child.text().lower()
                        if edit.isVisible() and (not q or q in fl or q in key.lower()) or not q:
                            child.setVisible(True)

    def _populate_meta_fields(self, bundle: metadata.NativeMetadataBundle) -> None:
        for key, edit in self.meta_fields.items():
            is_iptc = edit.property("meta_iptc")
            val = bundle.iptc.get(key, "") if is_iptc else bundle.exif.get(key, "")
            edit.blockSignals(True)
            edit.setText(val)
            edit.blockSignals(False)
        self._refresh_dirty_state()

    def _reload_metadata_from_reference(self) -> None:
        if self.reference_bundle:
            self.metadata_edits = metadata.NativeMetadataBundle()
            self._populate_meta_fields(self.reference_bundle)
            self.spin_presentation.setValue(0)

    def _on_meta_edit(self) -> None:
        self.metadata_edits = metadata.NativeMetadataBundle()
        for key, edit in self.meta_fields.items():
            text = edit.text().strip()
            if not text:
                continue
            if edit.property("meta_iptc"):
                self.metadata_edits.iptc[key] = text
            else:
                self.metadata_edits.exif[key] = text
        self._refresh_dirty_state()

    def _on_presentation_edit(self, v: int) -> None:
        if v > 0:
            self.metadata_edits.presentation_timestamp_us = v
            self.metadata_edits.presentation_timestamp_user_set = True

    def _refresh_dirty_state(self) -> None:
        base = self.reference_bundle
        for key, edit in self.meta_fields.items():
            text = edit.text().strip()
            if not base:
                dirty = bool(text)
            else:
                is_iptc = edit.property("meta_iptc")
                orig = base.iptc.get(key, "") if is_iptc else base.exif.get(key, "")
                dirty = text != orig
            edit.setObjectName("dirtyField" if dirty else "")
            edit.style().unpolish(edit)
            edit.style().polish(edit)

    def _build_metadata_for_mux(self) -> metadata.NativeMetadataBundle | None:
        if (
            not self.reference_bundle
            and not self.metadata_edits.exif
            and not self.metadata_edits.iptc
        ):
            return None
        base = self.reference_bundle or metadata.NativeMetadataBundle()
        return metadata.merge_bundles(base, self.metadata_edits)

    # --- Export ---
    def _pick_output(self) -> None:
        if not self.video_path:
            QtWidgets.QMessageBox.warning(self, "未选择视频", "请先在「视频」步骤选择视频。")
            return
        default = self.video_path.with_suffix(".live.jpg")
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            self, "另存为", str(default), "JPEG (*.jpg)"
        )
        if path:
            self.out_edit.setText(path)

    def _do_convert(self) -> None:
        if not self._can_convert():
            if not self.video_path:
                QtWidgets.QMessageBox.warning(self, "未选择视频", "请先在「视频」步骤选择视频。")
            elif self.radio_cover_ref.isChecked() and not self.reference_path:
                QtWidgets.QMessageBox.warning(
                    self, "缺少参考图", "封面来自参考图时，请先在「原生图」步骤选择参考原生图。"
                )
            return
        assert self.video_path is not None
        out = (
            Path(self.out_edit.text())
            if self.out_edit.text().strip()
            else self.video_path.with_suffix(".live.jpg")
        )

        cover_mode: metadata.CoverMode = (
            "reference" if self.radio_cover_ref.isChecked() else "video"
        )
        meta_for_mux = self._build_metadata_for_mux()
        ref_bundle = self.reference_bundle
        presentation_ts = metadata.compute_presentation_timestamp_us(
            cover_mode=cover_mode,
            cover_time=self.spin_cover.value(),
            start=self.spin_start.value(),
            reference_ts=ref_bundle.presentation_timestamp_us if ref_bundle else None,
            user_override=meta_for_mux.presentation_timestamp_us if meta_for_mux else None,
            user_set=bool(meta_for_mux and meta_for_mux.presentation_timestamp_user_set),
        )

        params: ConvertParams = {
            "start": self.spin_start.value(),
            "duration": self.spin_duration.value(),
            "cover_time": self.spin_cover.value(),
            "long_edge": self.spin_long_edge.value(),
            "crf": self.spin_crf.value(),
            "audio_kbps": self.spin_audio.value(),
            "cover_mode": cover_mode,
            "video_mode": "clip" if self.radio_video_clip.isChecked() else "full",
            "presentation_timestamp_us": presentation_ts,
            "metadata_overrides": meta_for_mux,
        }
        if self.reference_path:
            params["reference_image"] = str(self.reference_path)

        self._step = 4
        self._apply_step()
        self._run_worker(self.video_path, out, params)

    def _run_worker(self, video: Path, output: Path, params: ConvertParams) -> None:
        self._convert_running = True
        self.btn_convert.setEnabled(False)
        self.btn_convert.setText("正在合成…")
        self.export_status.setText("处理中...")
        self.export_progress.setVisible(True)
        self.export_progress.setRange(0, 0)
        self.log_edit.clear()
        self.log_edit.setVisible(True)
        self._update_nav()

        self.thread = QtCore.QThread(self)
        self.worker = ConvertWorker(video, output, params)
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.progress.connect(self._on_progress)
        self.worker.finished.connect(self._on_done)
        self.worker.failed.connect(self._on_fail)
        self.worker.finished.connect(self.thread.quit)
        self.worker.failed.connect(self.thread.quit)
        self.thread.finished.connect(self.thread.deleteLater)
        self.thread.start()

    def _on_progress(self, msg: str) -> None:
        self.export_status.setText(msg)
        self.log_edit.append(msg)

    def _on_done(self, out: Path) -> None:
        self._convert_running = False
        self.btn_convert.setEnabled(True)
        self.btn_convert.setText("开始转换")
        self.export_progress.setRange(0, 1)
        self.export_progress.setValue(1)
        total_bytes = out.stat().st_size
        size_mb = total_bytes / (1024 * 1024)
        detail = getattr(self.worker, "_result_detail", {}) if self.worker else {}
        clip_bytes = int(detail.get("clip_bytes", 0))
        clip_dur = float(detail.get("clip_duration", 0))
        video_mode = str(detail.get("video_mode", "full"))
        jpeg_kb = max(0, (total_bytes - clip_bytes) // 1024)
        clip_kb = clip_bytes // 1024
        if video_mode == "full":
            breakdown = f"封面 JPEG ≈ {jpeg_kb} KB + 原视频 ≈ {clip_kb} KB"
        else:
            breakdown = (
                f"封面 JPEG ≈ {jpeg_kb} KB + 视频片段 {clip_dur:.1f}s ≈ {clip_kb} KB"
                if clip_bytes
                else "（未记录片段大小）"
            )
        self.export_status.setText(f"完成 · {size_mb:.2f} MB → {out}")
        self._update_nav()
        self._update_export_state()
        QtWidgets.QMessageBox.information(
            self,
            "成功",
            f"实况图已保存：\n{out}\n"
            f"总大小：{size_mb:.2f} MB\n"
            f"{breakdown}\n\n"
            f"流程：live-photo-conv 式原图封面 + copy-img-meta + 原视频 append，"
            f"并注入 OPPO MotionPhoto/MPF 标签。",
        )

    def _on_fail(self, msg: str) -> None:
        self._convert_running = False
        self.btn_convert.setEnabled(True)
        self.btn_convert.setText("开始转换")
        self.export_progress.setVisible(False)
        self.export_status.setText("转换失败")
        self.log_edit.append(msg)
        self._update_nav()
        self._update_export_state()
        QtWidgets.QMessageBox.critical(self, "转换失败", msg)


# ---------- Batch tab ------------------------------------------------------

class BatchTab(QtWidgets.QWidget):
    def __init__(self):
        super().__init__()
        self.queue: list[Path] = []
        self.current_index = 0
        self.thread: QtCore.QThread | None = None
        self.worker: ConvertWorker | None = None
        self.failures: list[tuple[Path, str]] = []
        self._stop_requested = False
        self._build_ui()

    def _build_ui(self):
        v = QtWidgets.QVBoxLayout(self)
        v.setContentsMargins(12, 8, 12, 8)
        v.setSpacing(12)

        hint = QtWidgets.QLabel(
            "把视频文件拖到下面的列表，或点击「添加视频」。"
            "每个文件都会按下方参数转换。"
        )
        hint.setObjectName("sectionDesc")
        hint.setWordWrap(True)
        v.addWidget(hint)

        self.list = VideoListWidget()
        self.list.files_dropped.connect(self._on_files_dropped)
        v.addWidget(self.list, 1)

        btn_row = QtWidgets.QHBoxLayout()
        btn_add = QtWidgets.QPushButton("添加视频...")
        btn_add.clicked.connect(self._add_videos)
        btn_clear = QtWidgets.QPushButton("清空列表")
        btn_clear.clicked.connect(self.list.clear)
        btn_row.addWidget(btn_add)
        btn_row.addWidget(btn_clear)
        btn_row.addStretch(1)
        v.addLayout(btn_row)

        params = QtWidgets.QGroupBox("默认参数")
        f = QtWidgets.QFormLayout(params)
        self.spin_start = QtWidgets.QDoubleSpinBox()
        self.spin_start.setRange(0, 99999)
        self.spin_start.setSuffix(" 秒")
        f.addRow("片段起点：", self.spin_start)
        self.spin_duration = QtWidgets.QDoubleSpinBox()
        self.spin_duration.setRange(0.5, 10)
        self.spin_duration.setValue(3)
        self.spin_duration.setSuffix(" 秒")
        f.addRow("片段时长：", self.spin_duration)
        self.spin_long = QtWidgets.QSpinBox()
        self.spin_long.setRange(360, 4096)
        self.spin_long.setValue(1920)
        self.spin_long.setSuffix(" 像素")
        f.addRow("输出长边：", self.spin_long)
        self.spin_crf = QtWidgets.QSpinBox()
        self.spin_crf.setRange(14, 32)
        self.spin_crf.setValue(23)
        f.addRow("视频 CRF：", self.spin_crf)
        v.addWidget(params)

        out_row = QtWidgets.QHBoxLayout()
        self.out_edit = QtWidgets.QLineEdit()
        self.out_edit.setPlaceholderText("输出文件夹（留空则与源视频同目录）")
        btn_browse = QtWidgets.QPushButton("...")
        btn_browse.setMaximumWidth(40)
        btn_browse.clicked.connect(self._pick_dir)
        out_row.addWidget(QtWidgets.QLabel("输出目录："))
        out_row.addWidget(self.out_edit, 1)
        out_row.addWidget(btn_browse)
        v.addLayout(out_row)

        self.progress = QtWidgets.QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setValue(0)
        self.progress.setVisible(False)
        v.addWidget(self.progress)

        run_row = QtWidgets.QHBoxLayout()
        self.btn_run = QtWidgets.QPushButton("开始批量转换")
        self.btn_run.setObjectName("primaryButton")
        self.btn_run.clicked.connect(self._run_batch)
        self.btn_stop = QtWidgets.QPushButton("停止")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self._request_stop)
        run_row.addWidget(self.btn_run, 1)
        run_row.addWidget(self.btn_stop)
        v.addLayout(run_row)

        self.status = QtWidgets.QLabel("就绪")
        self.status.setObjectName("statusLabel")
        v.addWidget(self.status)

    def _on_files_dropped(self, files: list[Path]):
        for p in files:
            self._add_path(p)

    def _add_videos(self):
        paths, _ = QtWidgets.QFileDialog.getOpenFileNames(
            self, "添加视频", "",
            "视频文件 (*.mp4 *.mov *.mkv *.avi *.webm *.MP4 *.MOV)"
        )
        for p in paths:
            self._add_path(Path(p))

    def _add_path(self, p: Path):
        item = QtWidgets.QListWidgetItem(str(p))
        item.setData(Qt.UserRole, p)
        self.list.addItem(item)

    def _pick_dir(self):
        d = QtWidgets.QFileDialog.getExistingDirectory(self, "选择输出文件夹")
        if d:
            self.out_edit.setText(d)

    def _run_batch(self):
        items = [self.list.item(i) for i in range(self.list.count())]
        self.queue = [it.data(Qt.UserRole) for it in items]
        if not self.queue:
            QtWidgets.QMessageBox.information(self, "列表为空", "请先添加至少一个视频。")
            return
        self.current_index = 0
        self.failures = []
        self._stop_requested = False
        self.btn_run.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.progress.setRange(0, len(self.queue))
        self.progress.setValue(0)
        self.progress.setVisible(True)
        self._next()

    def _request_stop(self):
        self._stop_requested = True
        if self.worker:
            self.worker.cancel()
        self.status.setText("等待当前任务结束...")
        self.btn_stop.setEnabled(False)

    def _next(self):
        if self._stop_requested or self.current_index >= len(self.queue):
            self._on_batch_done()
            return
        video = self.queue[self.current_index]
        out_dir = (
            Path(self.out_edit.text()) if self.out_edit.text().strip() else video.parent
        )
        out = out_dir / (video.stem + ".live.jpg")
        params: ConvertParams = {
            "start": self.spin_start.value(),
            "duration": self.spin_duration.value(),
            "cover_time": self.spin_start.value(),
            "long_edge": self.spin_long.value(),
            "crf": self.spin_crf.value(),
            "audio_kbps": 128,
            "cover_mode": "video",
            "video_mode": "full",
        }
        self.status.setText(
            f"[{self.current_index+1}/{len(self.queue)}] {video.name} ..."
        )
        self.thread = QtCore.QThread(self)
        self.worker = ConvertWorker(video, out, params)
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.finished.connect(self._step_done)
        self.worker.failed.connect(self._step_failed)
        self.worker.finished.connect(self.thread.quit)
        self.worker.failed.connect(self.thread.quit)
        self.thread.finished.connect(self.thread.deleteLater)
        self.thread.start()

    def _step_done(self, _out: Path):
        self.current_index += 1
        self.progress.setValue(self.current_index)
        self._next()

    def _step_failed(self, msg: str):
        self.failures.append((self.queue[self.current_index], msg))
        self.current_index += 1
        self.progress.setValue(self.current_index)
        self._next()

    def _on_batch_done(self):
        self.btn_run.setEnabled(True)
        self.btn_stop.setEnabled(False)
        total = len(self.queue)
        ok = self.current_index - len(self.failures)
        if self._stop_requested:
            self.status.setText(
                f"已停止：完成 {ok}/{total}，失败 {len(self.failures)}"
            )
        else:
            self.status.setText(
                f"完成 {ok}/{total}，失败 {len(self.failures)}"
            )
        self._show_summary()

    def _show_summary(self):
        if not self.failures:
            QtWidgets.QMessageBox.information(
                self, "完成", f"批量转换完成，共 {self.current_index} 个文件。"
            )
            return
        lines = [f"共 {len(self.failures)} 个文件失败："]
        for path, msg in self.failures[:20]:
            first = msg.splitlines()[0] if msg else ""
            lines.append(f"\n• {path.name}\n  {first}")
        if len(self.failures) > 20:
            lines.append(f"\n... 还有 {len(self.failures) - 20} 个未列出")
        QtWidgets.QMessageBox.warning(self, "部分失败", "\n".join(lines))


# ---------- Main window ----------------------------------------------------

class MainWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("OPPO 实况图制作工具")
        self.setMinimumSize(720, 640)
        self.resize(900, 780)

        missing = ffmpeg_utils.check_dependencies()
        if missing:
            QtWidgets.QMessageBox.critical(
                self, "缺少依赖",
                "运行需要以下命令行工具，但在 PATH 中未找到：\n\n  - "
                + "\n  - ".join(missing)
                + "\n\n请先安装 ffmpeg（https://ffmpeg.org）。"
                  "exiftool 可运行 scripts/setup-exiftool.ps1 安装到项目 tools/ 目录，"
                  "或从 https://exiftool.org 安装并加入 PATH，然后重启本程序。"
            )

        central = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(central)
        layout.setContentsMargins(20, 20, 20, 12)
        layout.setSpacing(16)

        layout.addWidget(_build_brand_header())

        tabs = QtWidgets.QTabWidget()
        tabs.addTab(SingleTab(), "单视频转换")
        tabs.addTab(BatchTab(), "批量转换")
        layout.addWidget(tabs, 1)

        footer = QtWidgets.QLabel("MIT · chaseZ · 未与 OPPO 官方关联")
        footer.setObjectName("footerLabel")
        layout.addWidget(footer)

        self.setCentralWidget(central)


def main():
    app = QtWidgets.QApplication(sys.argv)
    gui_styles.apply_app_style(app)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
