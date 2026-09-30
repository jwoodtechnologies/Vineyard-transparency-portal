"""Page-preserving chunking for retrieval.

Chunks never cross a page boundary, so every chunk has an exact page. Long pages are split at
paragraph boundaries, then sentence boundaries, never mid-sentence unless a single sentence is
longer than the hard limit.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .extract import Page

TARGET = 1800
HARD_MAX = 3500
MIN_TAIL = 300

HEADING = re.compile(
    r"^(?:(?:[IVXLC]+|\d{1,2}(?:\.\d{1,2})*|[A-Z])[.)]\s+.{3,120}|[A-Z][A-Z0-9 ,.&/'()-]{6,100})$"
)


@dataclass
class Chunk:
    index: int
    page_start: int | None
    page_end: int | None
    section_title: str | None
    text: str
    ocr: bool = False


def _sentences(p: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])", p)
    return [s for s in parts if s.strip()]


def _pieces(text: str) -> list[str]:
    """Paragraphs, with over-long paragraphs broken into sentence groups."""
    out: list[str] = []
    for para in re.split(r"\n\s*\n|\n(?=[A-Z0-9][^\n]{0,80}\n)", text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= HARD_MAX:
            out.append(para)
            continue
        buf = ""
        for s in _sentences(para):
            while len(s) > HARD_MAX:
                out.append(s[:HARD_MAX])
                s = s[HARD_MAX:]
            if len(buf) + len(s) + 1 > TARGET and buf:
                out.append(buf)
                buf = s
            else:
                buf = f"{buf} {s}".strip()
        if buf:
            out.append(buf)
    return out


def detect_heading(line: str) -> str | None:
    line = line.strip()
    if 6 <= len(line) <= 120 and HEADING.match(line) and not line.endswith(","):
        return line
    return None


def chunk_pages(pages: list[Page]) -> list[Chunk]:
    chunks: list[Chunk] = []
    section: str | None = None
    for page in pages:
        if page.section:
            section = page.section
        buf = ""
        buf_section = section
        for piece in _pieces(page.text):
            first_line = piece.split("\n", 1)[0]
            h = detect_heading(first_line)
            if len(buf) + len(piece) + 2 > TARGET and len(buf) >= MIN_TAIL:
                chunks.append(Chunk(len(chunks), page.number, page.number, buf_section, buf.strip(), page.ocr))
                buf = ""
            if h:
                section = h[:200]
            if not buf:
                buf_section = section
            buf = f"{buf}\n\n{piece}" if buf else piece
        if buf.strip():
            chunks.append(Chunk(len(chunks), page.number, page.number, buf_section, buf.strip(), page.ocr))
    return chunks
