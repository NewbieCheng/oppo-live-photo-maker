"""Dark gallery QSS aligned with web/src/style.css."""
# SPDX-License-Identifier: MIT
from __future__ import annotations

from PySide6 import QtWidgets

# Gallery darkroom palette (mirrors web CSS variables)
BG_DEEP = "#0a0908"
BG_SHELL = "#11100f"
BG_PANEL = "#181614"
BG_INPUT = "#201e1b"
BG_HOVER = "#262320"

TEXT = "#f0ebe3"
TEXT_SOFT = "#a9a299"
TEXT_FAINT = "#6f6a63"

LIVE = "#3bdc97"
LIVE_DIM = "rgba(59, 220, 151, 0.14)"
LIVE_GLOW = "rgba(59, 220, 151, 0.35)"
WARM = "#d4a853"
WARM_DIM = "rgba(212, 168, 83, 0.12)"

BORDER = "#2c2926"
BORDER_STRONG = "#3d3934"

DANGER = "#e86a5a"
SUCCESS_BG = "rgba(59, 220, 151, 0.08)"

APP_STYLE = f"""
QMainWindow, QWidget {{
    background-color: {BG_DEEP};
    color: {TEXT};
    font-family: "Segoe UI", "Microsoft YaHei UI", "Noto Sans SC", sans-serif;
    font-size: 14px;
}}

QTabWidget::pane {{
    border: 1px solid {BORDER};
    border-radius: 10px;
    background: {BG_SHELL};
    top: -1px;
    padding: 4px;
}}

QTabBar::tab {{
    background: {BG_PANEL};
    color: {TEXT_SOFT};
    border: 1px solid {BORDER};
    border-bottom: none;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    padding: 10px 20px;
    margin-right: 4px;
    font-weight: 500;
}}
QTabBar::tab:selected {{
    background: {BG_SHELL};
    color: {LIVE};
    border-color: {BORDER_STRONG};
    border-bottom: 1px solid {BG_SHELL};
}}
QTabBar::tab:hover:!selected {{
    background: {BG_HOVER};
    color: {TEXT};
}}

QGroupBox {{
    background: {BG_PANEL};
    border: 1px solid {BORDER};
    border-radius: 12px;
    margin-top: 14px;
    padding: 18px 14px 14px 14px;
    font-weight: 600;
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    subcontrol-position: top left;
    left: 12px;
    padding: 0 8px;
    color: {TEXT};
    font-size: 15px;
}}

QLabel#brandTitle {{
    font-size: 26px;
    font-weight: 600;
    color: {TEXT};
    letter-spacing: 1px;
}}

QLabel#tagline {{
    color: {TEXT_SOFT};
    font-size: 13px;
    line-height: 1.5;
}}

QLabel#taglineAccent {{
    color: {LIVE};
    font-weight: 500;
}}

QLabel#liveBadge {{
    background: {LIVE_DIM};
    border: 1px solid rgba(59, 220, 151, 0.25);
    border-radius: 14px;
    padding: 4px 14px 4px 10px;
    color: {LIVE};
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 1px;
}}

QLabel#footerLabel {{
    color: {TEXT_FAINT};
    font-size: 12px;
    padding-top: 8px;
    border-top: 1px solid {BORDER};
}}

QLabel#sectionDesc {{
    color: {TEXT_SOFT};
    font-size: 13px;
    margin-bottom: 4px;
}}

QLabel#statusLabel {{
    color: {TEXT_FAINT};
    font-size: 13px;
    padding: 4px 0;
}}

QLabel#stepHint {{
    color: {TEXT_FAINT};
    font-size: 12px;
    padding: 6px 0 2px 0;
}}

QLabel#stepHintActive {{
    color: {LIVE};
    font-weight: 600;
}}

QLabel#chip, QLabel#chipAccent {{
    border-radius: 10px;
    padding: 3px 10px;
    font-size: 11px;
}}
QLabel#chip {{
    background: {BG_INPUT};
    border: 1px solid {BORDER};
    color: {TEXT_SOFT};
}}
QLabel#chipAccent {{
    background: {LIVE_DIM};
    border: 1px solid {LIVE};
    color: {LIVE};
}}

QPushButton {{
    background: {BG_INPUT};
    color: {TEXT};
    border: 1px solid {BORDER_STRONG};
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 500;
    min-height: 20px;
}}
QPushButton:hover {{
    background: {BG_HOVER};
    border-color: {TEXT_FAINT};
}}
QPushButton:pressed {{
    background: {BG_PANEL};
}}
QPushButton:disabled {{
    opacity: 0.38;
}}

QPushButton#primaryButton {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
        stop:0 #2ec484, stop:1 {LIVE});
    color: #0a1a12;
    border: none;
    border-radius: 6px;
    font-size: 15px;
    font-weight: 600;
    padding: 12px 20px;
    min-height: 28px;
}}
QPushButton#primaryButton:hover {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
        stop:0 #3bdc97, stop:1 #52e8a8);
    color: #071510;
}}
QPushButton#primaryButton:disabled {{
    background: {BG_INPUT};
    color: {TEXT_FAINT};
    border: 1px solid {BORDER};
}}

QPushButton#ghostButton {{
    background: transparent;
    border: none;
    color: {LIVE};
    padding: 6px 10px;
}}
QPushButton#ghostButton:hover {{
    background: {LIVE_DIM};
}}

QLineEdit, QSpinBox, QDoubleSpinBox {{
    background: {BG_INPUT};
    color: {TEXT};
    border: 1px solid {BORDER};
    border-radius: 6px;
    padding: 8px 10px;
    selection-background-color: {LIVE_DIM};
    selection-color: {TEXT};
}}
QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus {{
    border-color: {LIVE};
}}
QLineEdit:read-only {{
    color: {TEXT_SOFT};
}}

QSpinBox::up-button, QSpinBox::down-button,
QDoubleSpinBox::up-button, QDoubleSpinBox::down-button {{
    background: {BG_HOVER};
    border: none;
    width: 18px;
}}
QSpinBox::up-button:hover, QSpinBox::down-button:hover,
QDoubleSpinBox::up-button:hover, QDoubleSpinBox::down-button:hover {{
    background: {BORDER_STRONG};
}}

QSlider::groove:horizontal {{
    height: 4px;
    background: {BG_INPUT};
    border-radius: 2px;
}}
QSlider::handle:horizontal {{
    width: 14px;
    height: 14px;
    margin: -5px 0;
    background: {LIVE};
    border-radius: 7px;
}}
QSlider::sub-page:horizontal {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #2ec484, stop:1 {LIVE});
    border-radius: 2px;
}}

QRadioButton {{
    spacing: 8px;
    color: {TEXT};
    padding: 4px 0;
}}
QRadioButton::indicator {{
    width: 16px;
    height: 16px;
    border-radius: 8px;
    border: 2px solid {BORDER_STRONG};
    background: {BG_INPUT};
}}
QRadioButton::indicator:checked {{
    border-color: {LIVE};
    background: {LIVE};
}}

QScrollArea {{
    background: transparent;
    border: none;
}}
QScrollBar:vertical {{
    background: {BG_INPUT};
    width: 10px;
    border-radius: 5px;
}}
QScrollBar::handle:vertical {{
    background: {BORDER_STRONG};
    border-radius: 5px;
    min-height: 24px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0;
}}

QListWidget {{
    background: {BG_PANEL};
    border: 1px dashed {BORDER_STRONG};
    border-radius: 12px;
    padding: 8px;
    color: {TEXT};
    outline: none;
}}
QListWidget::item {{
    padding: 8px 10px;
    border-radius: 6px;
    margin: 2px 0;
}}
QListWidget::item:selected {{
    background: {LIVE_DIM};
    color: {LIVE};
}}
QListWidget::item:hover {{
    background: {BG_HOVER};
}}

QProgressBar {{
    background: {BG_INPUT};
    border: none;
    border-radius: 2px;
    height: 4px;
    text-align: center;
    color: transparent;
}}
QProgressBar::chunk {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 #2ec484, stop:1 {LIVE});
    border-radius: 2px;
}}

QVideoWidget {{
    background: #000000;
    border: 1px solid {BORDER};
    border-radius: 10px;
}}

QMessageBox {{
    background: {BG_PANEL};
}}
QMessageBox QLabel {{
    color: {TEXT};
}}
"""


def apply_app_style(app: QtWidgets.QApplication) -> None:
    """Apply Fusion + dark gallery stylesheet."""
    app.setStyle("Fusion")
    app.setStyleSheet(APP_STYLE)
