"""StorageProvider for the ingestion side.

WorkerArchiveStorage uploads through the Worker (which writes to R2 and enforces the hard stop).
LocalFilesystemStorage keeps content-addressed copies on disk for development.
"""
from __future__ import annotations

import os
import shutil

from .api import PortalApi


def archive_key(sha256: str, ext: str) -> str:
    ext = ext if ext.isalnum() and len(ext) <= 8 else "bin"
    return f"documents/{sha256[:2]}/{sha256}.{ext}"


class StorageProvider:
    name = "base"

    def store(self, sha256: str, path: str, size: int, content_type: str, ext: str) -> dict:
        raise NotImplementedError


class WorkerArchiveStorage(StorageProvider):
    name = "r2-via-worker"

    def __init__(self, api: PortalApi):
        self.api = api

    def store(self, sha256, path, size, content_type, ext):
        return self.api.put_archive(sha256, path, size, content_type, ext)


class LocalFilesystemStorage(StorageProvider):
    name = "local"

    def __init__(self, root: str):
        self.root = root

    def store(self, sha256, path, size, content_type, ext):
        dest = os.path.join(self.root, archive_key(sha256, ext))
        if os.path.exists(dest):
            return {"status": "exists", "key": archive_key(sha256, ext), "size": size}
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(path, dest)
        return {"status": "archived", "key": archive_key(sha256, ext), "size": size}
