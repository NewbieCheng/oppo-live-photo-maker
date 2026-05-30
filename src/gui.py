"""GUI for OPPO Live Photo Maker (PySide6) - 中文界面."""
from __future__ import annotations

import sys
import tempfile
import traceback
from pathlib import Path

from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtCore import Qt, QUrl, Signal
from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput
from PySide6.QtMultimediaWidgets import QVideoWidget

from . import ffmpeg_utils, muxer


# ---------- Worker thread ---------------------------------------------------

class ConvertWorker(QtCore.QObject):
    """后台线程执行单次转换。"""
    progress = Signal(str)
    finished = Signal(Path)
    failed = Signal(str)

    def __init__(self, video: Path, output: Path, params: dict):
        super().__init__()
        self.video = video
        self.output = output
        self.params = params

    @QtCore.Slot()
    def run(self):
        try:
            with tempfile.TemporaryDirectory() as td:
                td_path = Path(td)
                cover = td_path / "cover.jpg"
                clip = td_path / "clip.mp4"
                p = self.params
                self.progress.emit("正在抽取封面帧...")
                ffmpeg_utils.extract_cover(
                    self.video, cover,
                    timestamp=p["cover_time"],
                    target_long_edge=p["long_edge"],
                )
                self.progress.emit("正在编码视频片段...")
                ffmpeg_utils.transcode_clip(
                    self.video, clip,
                    start=p["start"],
                    duration=p["duration"],
                    target_long_edge=p["long_edge"],
                    crf=p["crf"],
                    audio_bitrate_k=p["audio_kbps"],
                )
                self.progress.emit("正在合成 OPPO 实况图...")
                muxer.write_oppo_motionphoto(cover, clip, self.output)
            self.finished.emit(self.output)
        except Exception as e:
            tb = traceback.format_exc()
            self.failed.emit(f"{e}\n\n{tb}")


# ---------- Single convert tab ---------------------------------------------

class SingleTab(QtWidgets.QWidget):
    def __init__(self):
        super().__init__()
        self.video_path: Path | None = None
        self.video_info: ffmpeg_utils.VideoInfo | None = None
        self.thread: QtCore.QThread | None = None
        self.worker: ConvertWorker | None = None
        self._cover_user_set = False

        self._build_ui()

    def _build_ui(self):
        v = QtWidgets.QVBoxLayout(self)

        # Top bar
        top = QtWidgets.QHBoxLayout()
        self.path_edit = QtWidgets.QLineEdit()
        self.path_edit.setPlaceholderText("请选择一个视频文件...")
        self.path_edit.setReadOnly(True)
        btn_open = QtWidgets.QPushButton("打开视频...")
        btn_open.clicked.connect(self._pick_video)
        top.addWidget(self.path_edit, 1)
        top.addWidget(btn_open)
        v.addLayout(top)

        # Video preview
        self.video_widget = QVideoWidget()
        self.video_widget.setMinimumHeight(320)
        v.addWidget(self.video_widget, 1)

        self.player = QMediaPlayer(self)
        self.audio_out = QAudioOutput(self)
        self.player.setAudioOutput(self.audio_out)
        self.player.setVideoOutput(self.video_widget)
        self.audio_out.setVolume(0.5)
        self.player.positionChanged.connect(self._on_position)
        self.player.durationChanged.connect(self._on_duration)

        # Playback controls
        ctrl = QtWidgets.QHBoxLayout()
        self.btn_play = QtWidgets.QPushButton("播放")
        self.btn_play.clicked.connect(self._toggle_play)
        self.btn_set_start = QtWidgets.QPushButton("此处设为起点")
        self.btn_set_start.setToolTip("把当前预览位置设为 3 秒片段的起点")
        self.btn_set_start.clicked.connect(self._set_start_from_preview)
        self.btn_set_cover = QtWidgets.QPushButton("此处设为封面")
        self.btn_set_cover.setToolTip("把当前预览位置设为静态封面帧")
        self.btn_set_cover.clicked.connect(self._set_cover_from_preview)
        self.lbl_pos = QtWidgets.QLabel("0.00 秒 / 0.00 秒")
        ctrl.addWidget(self.btn_play)
        ctrl.addWidget(self.btn_set_start)
        ctrl.addWidget(self.btn_set_cover)
        ctrl.addStretch(1)
        ctrl.addWidget(self.lbl_pos)
        v.addLayout(ctrl)

        # Slider
        self.slider = QtWidgets.QSlider(Qt.Horizontal)
        self.slider.setRange(0, 0)
        self.slider.sliderMoved.connect(self._slider_seek)
        v.addWidget(self.slider)

        # Parameter form
        form_box = QtWidgets.QGroupBox("片段参数")
        form = QtWidgets.QFormLayout(form_box)

        self.spin_start = QtWidgets.QDoubleSpinBox()
        self.spin_start.setRange(0.0, 99999.0)
        self.spin_start.setDecimals(2)
        self.spin_start.setSuffix(" 秒")
        self.spin_start.valueChanged.connect(self._sync_cover_default)
        form.addRow("片段起点：", self.spin_start)

        self.spin_duration = QtWidgets.QDoubleSpinBox()
        self.spin_duration.setRange(0.5, 10.0)
        self.spin_duration.setDecimals(2)
        self.spin_duration.setValue(3.0)
        self.spin_duration.setSuffix(" 秒")
        form.addRow("片段时长：", self.spin_duration)

        self.spin_cover = QtWidgets.QDoubleSpinBox()
        self.spin_cover.setRange(0.0, 99999.0)
        self.spin_cover.setDecimals(2)
        self.spin_cover.setSuffix(" 秒")
        self.spin_cover.valueChanged.connect(self._mark_cover_user_set)
        form.addRow("封面帧位置：", self.spin_cover)

        v.addWidget(form_box)

        # Advanced
        adv_box = QtWidgets.QGroupBox("高级参数（可选）")
        adv_box.setCheckable(True)
        adv_box.setChecked(False)
        adv_layout = QtWidgets.QFormLayout(adv_box)
        self.spin_long_edge = QtWidgets.QSpinBox()
        self.spin_long_edge.setRange(360, 4096)
        self.spin_long_edge.setValue(1920)
        self.spin_long_edge.setSuffix(" 像素")
        adv_layout.addRow("输出长边：", self.spin_long_edge)
        self.spin_crf = QtWidgets.QSpinBox()
        self.spin_crf.setRange(14, 32)
        self.spin_crf.setValue(23)
        self.spin_crf.setToolTip("CRF 越小画质越好但文件越大")
        adv_layout.addRow("视频 CRF：", self.spin_crf)
        self.spin_audio = QtWidgets.QSpinBox()
        self.spin_audio.setRange(64, 320)
        self.spin_audio.setValue(128)
        self.spin_audio.setSuffix(" kbps")
        adv_layout.addRow("音频码率：", self.spin_audio)
        v.addWidget(adv_box)
        self.adv_box = adv_box

        # Output
        out_row = QtWidgets.QHBoxLayout()
        self.out_edit = QtWidgets.QLineEdit()
        self.out_edit.setPlaceholderText("输出路径（留空则自动生成）")
        btn_browse = QtWidgets.QPushButton("...")
        btn_browse.setMaximumWidth(40)
        btn_browse.clicked.connect(self._pick_output)
        out_row.addWidget(QtWidgets.QLabel("输出："))
        out_row.addWidget(self.out_edit, 1)
        out_row.addWidget(btn_browse)
        v.addLayout(out_row)

        self.btn_convert = QtWidgets.QPushButton("导出实况图")
        self.btn_convert.setStyleSheet("padding: 10px; font-weight: bold;")
        self.btn_convert.clicked.connect(self._do_convert)
        v.addWidget(self.btn_convert)

        self.status = QtWidgets.QLabel("就绪")
        self.status.setStyleSheet("color: #888;")
        v.addWidget(self.status)

    # --- video ---
    def _pick_video(self):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "选择视频", "",
            "视频文件 (*.mp4 *.mov *.mkv *.avi *.webm *.MP4 *.MOV);;所有文件 (*.*)"
        )
        if path:
            self.load_video(Path(path))

    def load_video(self, path: Path):
        try:
            info = ffmpeg_utils.probe(path)
        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "读取视频信息失败", str(e))
            return
        self.video_path = path
        self.video_info = info
        self._cover_user_set = False
        self.path_edit.setText(str(path))
        self.player.setSource(QUrl.fromLocalFile(str(path)))
        self.spin_start.setRange(0.0, max(0.0, info.duration - 0.5))
        self.spin_cover.setRange(0.0, max(0.0, info.duration))
        self.spin_start.setValue(0.0)
        self.spin_cover.setValue(0.0)
        self.spin_duration.setMaximum(min(10.0, info.duration))
        if info.duration < 3.0:
            self.spin_duration.setValue(max(0.5, info.duration))
        else:
            self.spin_duration.setValue(3.0)
        self.status.setText(
            f"已加载 {path.name}（{info.display_width}×{info.display_height}，"
            f"{info.duration:.2f} 秒，旋转 {info.rotation}°）"
        )

    def _on_duration(self, ms: int):
        self.slider.setRange(0, ms)

    def _on_position(self, ms: int):
        self.slider.setValue(ms)
        dur = self.player.duration() / 1000.0
        self.lbl_pos.setText(f"{ms/1000:.2f} 秒 / {dur:.2f} 秒")

    def _slider_seek(self, ms: int):
        self.player.setPosition(ms)

    def _toggle_play(self):
        if self.player.playbackState() == QMediaPlayer.PlayingState:
            self.player.pause()
            self.btn_play.setText("播放")
        else:
            self.player.play()
            self.btn_play.setText("暂停")

    def _set_start_from_preview(self):
        t = self.player.position() / 1000.0
        self.spin_start.setValue(t)

    def _set_cover_from_preview(self):
        t = self.player.position() / 1000.0
        self._cover_user_set = True
        self.spin_cover.setValue(t)

    def _mark_cover_user_set(self):
        # Triggered both by user spin and by _sync_cover_default; only mark
        # as user-set when value differs from current start value.
        if abs(self.spin_cover.value() - self.spin_start.value()) > 1e-3:
            self._cover_user_set = True

    def _sync_cover_default(self, v: float):
        if not self._cover_user_set:
            self.spin_cover.setValue(v)

    # --- output ---
    def _pick_output(self):
        if not self.video_path:
            return
        default = self.video_path.with_suffix(".live.jpg")
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            self, "另存为", str(default), "JPEG (*.jpg)"
        )
        if path:
            self.out_edit.setText(path)

    def _do_convert(self):
        if not self.video_path:
            QtWidgets.QMessageBox.warning(self, "未选择视频", "请先选择一个视频文件。")
            return
        out = Path(self.out_edit.text()) if self.out_edit.text().strip() \
            else self.video_path.with_suffix(".live.jpg")
        params = {
            "start": self.spin_start.value(),
            "duration": self.spin_duration.value(),
            "cover_time": self.spin_cover.value(),
            "long_edge": self.spin_long_edge.value(),
            "crf": self.spin_crf.value(),
            "audio_kbps": self.spin_audio.value(),
        }
        self._run_worker(self.video_path, out, params)

    def _run_worker(self, video: Path, output: Path, params: dict):
        self.btn_convert.setEnabled(False)
        self.status.setText("处理中...")
        self.thread = QtCore.QThread(self)
        self.worker = ConvertWorker(video, output, params)
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.progress.connect(self.status.setText)
        self.worker.finished.connect(self._on_done)
        self.worker.failed.connect(self._on_fail)
        self.worker.finished.connect(self.thread.quit)
        self.worker.failed.connect(self.thread.quit)
        self.thread.finished.connect(self.thread.deleteLater)
        self.thread.start()

    def _on_done(self, out: Path):
        self.btn_convert.setEnabled(True)
        size_mb = out.stat().st_size / (1024 * 1024)
        self.status.setText(f"完成 -> {out}（{size_mb:.2f} MB）")
        QtWidgets.QMessageBox.information(
            self, "成功", f"实况图已保存：\n{out}\n大小：{size_mb:.2f} MB"
        )

    def _on_fail(self, msg: str):
        self.btn_convert.setEnabled(True)
        self.status.setText("失败")
        QtWidgets.QMessageBox.critical(self, "转换失败", msg)


# ---------- Batch tab ------------------------------------------------------

class BatchTab(QtWidgets.QWidget):
    def __init__(self):
        super().__init__()
        self.threads: list[QtCore.QThread] = []
        self.queue: list[Path] = []
        self.current_index = 0
        self._build_ui()

    def _build_ui(self):
        v = QtWidgets.QVBoxLayout(self)

        v.addWidget(QtWidgets.QLabel(
            "把视频文件拖到下面的列表，或点击「添加视频」。"
            "每个文件都会按下方参数转换。"
        ))

        self.list = QtWidgets.QListWidget()
        self.list.setAcceptDrops(True)
        self.list.setSelectionMode(QtWidgets.QAbstractItemView.ExtendedSelection)
        self.list.setDragDropMode(QtWidgets.QAbstractItemView.DropOnly)
        self.list.dragEnterEvent = self._drag_enter
        self.list.dragMoveEvent = self._drag_enter
        self.list.dropEvent = self._drop
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
        self.spin_start.setRange(0, 99999); self.spin_start.setSuffix(" 秒")
        f.addRow("片段起点：", self.spin_start)
        self.spin_duration = QtWidgets.QDoubleSpinBox()
        self.spin_duration.setRange(0.5, 10); self.spin_duration.setValue(3); self.spin_duration.setSuffix(" 秒")
        f.addRow("片段时长：", self.spin_duration)
        self.spin_long = QtWidgets.QSpinBox()
        self.spin_long.setRange(360, 4096); self.spin_long.setValue(1920); self.spin_long.setSuffix(" 像素")
        f.addRow("输出长边：", self.spin_long)
        self.spin_crf = QtWidgets.QSpinBox()
        self.spin_crf.setRange(14, 32); self.spin_crf.setValue(23)
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

        self.btn_run = QtWidgets.QPushButton("开始批量转换")
        self.btn_run.setStyleSheet("padding: 10px; font-weight: bold;")
        self.btn_run.clicked.connect(self._run_batch)
        v.addWidget(self.btn_run)

        self.status = QtWidgets.QLabel("就绪")
        v.addWidget(self.status)

    def _drag_enter(self, e: QtGui.QDragEnterEvent):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def _drop(self, e: QtGui.QDropEvent):
        for url in e.mimeData().urls():
            p = Path(url.toLocalFile())
            if p.is_file():
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
        self.btn_run.setEnabled(False)
        self._next()

    def _next(self):
        if self.current_index >= len(self.queue):
            self.status.setText(f"全部完成，共 {len(self.queue)} 个文件。")
            self.btn_run.setEnabled(True)
            QtWidgets.QMessageBox.information(self, "完成", "批量转换已完成。")
            return
        video = self.queue[self.current_index]
        out_dir = Path(self.out_edit.text()) if self.out_edit.text().strip() else video.parent
        out = out_dir / (video.stem + ".live.jpg")
        params = {
            "start": self.spin_start.value(),
            "duration": self.spin_duration.value(),
            "cover_time": self.spin_start.value(),
            "long_edge": self.spin_long.value(),
            "crf": self.spin_crf.value(),
            "audio_kbps": 128,
        }
        self.status.setText(
            f"[{self.current_index+1}/{len(self.queue)}] {video.name} ..."
        )
        thread = QtCore.QThread(self)
        worker = ConvertWorker(video, out, params)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.finished.connect(lambda _o: self._step_done())
        worker.failed.connect(lambda msg: self._step_failed(msg))
        worker.finished.connect(thread.quit)
        worker.failed.connect(thread.quit)
        thread.finished.connect(thread.deleteLater)
        self.threads.append(thread)
        self._cur_worker = worker
        thread.start()

    def _step_done(self):
        self.current_index += 1
        self._next()

    def _step_failed(self, msg: str):
        QtWidgets.QMessageBox.warning(
            self, "其中一个文件失败",
            f"{self.queue[self.current_index].name}\n\n{msg}"
        )
        self.current_index += 1
        self._next()


# ---------- Main window ----------------------------------------------------

class MainWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("OPPO 实况图制作工具")
        self.resize(900, 780)

        missing = ffmpeg_utils.check_dependencies()
        if missing:
            QtWidgets.QMessageBox.critical(
                self, "缺少依赖",
                "运行需要以下命令行工具，但在 PATH 中未找到：\n\n  - "
                + "\n  - ".join(missing)
                + "\n\n请先安装 ffmpeg（https://ffmpeg.org）"
                  "和 exiftool（https://exiftool.org），然后重启本程序。"
            )

        tabs = QtWidgets.QTabWidget()
        tabs.addTab(SingleTab(), "单视频转换")
        tabs.addTab(BatchTab(), "批量转换")
        self.setCentralWidget(tabs)


def main():
    app = QtWidgets.QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
