import os
import tempfile
import unittest

from ingest.api import PortalApi
from ingest.storage import WorkerArchiveStorage

SHA = "ab" * 32


class FakeApi(PortalApi):
    """PortalApi with the HTTP layer replaced: records every call and answers like the Worker."""

    def __init__(self, fail_on_part: int | None = None, create_status: str = "created"):
        self.calls = []
        self.fail_on_part = fail_on_part
        self.create_status = create_status

    def call(self, method, path, *, json_body=None, data=None, headers=None, params=None, ok=(200, 201)):
        self.calls.append({"method": method, "path": path, "json": json_body, "size": len(data) if isinstance(data, (bytes, bytearray)) else None, "params": params, "headers": headers})
        if path.endswith("/create"):
            if self.create_status != "created":
                return {"status": self.create_status}
            return {"status": "created", "uploadId": "up-1", "partBytes": 10}
        if path.endswith("/part"):
            if self.fail_on_part == params["partNumber"]:
                raise RuntimeError("network down")
            return {"partNumber": params["partNumber"], "etag": f"e{params['partNumber']}"}
        if path.endswith("/complete"):
            return {"status": "archived", "size": json_body["size"]}
        if path.endswith("/abort"):
            return {"status": "aborted"}
        if path.startswith("/archive/"):
            return {"status": "archived", "single": True}
        raise AssertionError(path)


def temp_file(size: int) -> str:
    fd, path = tempfile.mkstemp()
    with os.fdopen(fd, "wb") as f:
        f.write(bytes(i % 251 for i in range(size)))
    return path


class MultipartUploadTest(unittest.TestCase):
    def test_uploads_in_parts_of_the_size_the_worker_gives_and_completes(self):
        api = FakeApi()
        path = temp_file(25)
        try:
            out = api.put_archive_multipart(SHA, path, 25, "application/pdf", "pdf")
        finally:
            os.unlink(path)
        self.assertEqual(out["status"], "archived")
        self.assertEqual([c["path"].rsplit("/", 1)[1] for c in api.calls], ["create", "part", "part", "part", "complete"])
        self.assertEqual(api.calls[0]["json"], {"size": 25, "ext": "pdf", "contentType": "application/pdf"})
        self.assertEqual([c["size"] for c in api.calls if c["path"].endswith("/part")], [10, 10, 5])
        self.assertEqual([c["params"]["partNumber"] for c in api.calls if c["path"].endswith("/part")], [1, 2, 3])
        self.assertTrue(all(c["params"]["uploadId"] == "up-1" for c in api.calls if c["path"].endswith("/part")))
        self.assertEqual(api.calls[-1]["json"]["parts"], [{"partNumber": 1, "etag": "e1"}, {"partNumber": 2, "etag": "e2"}, {"partNumber": 3, "etag": "e3"}])
        self.assertTrue(api.calls[0]["path"].startswith(f"/archive/multipart/{SHA}/"))

    def test_aborts_when_a_part_fails(self):
        api = FakeApi(fail_on_part=2)
        path = temp_file(25)
        try:
            with self.assertRaises(RuntimeError):
                api.put_archive_multipart(SHA, path, 25, "application/pdf", "pdf")
        finally:
            os.unlink(path)
        self.assertTrue(api.calls[-1]["path"].endswith("/abort"))
        self.assertEqual(api.calls[-1]["json"], {"uploadId": "up-1", "ext": "pdf"})

    def test_uploads_nothing_when_the_worker_says_stored_or_past_the_stop(self):
        for status in ("exists", "quota_deferred"):
            api = FakeApi(create_status=status)
            path = temp_file(25)
            try:
                self.assertEqual(api.put_archive_multipart(SHA, path, 25, "application/pdf", "pdf")["status"], status)
            finally:
                os.unlink(path)
            self.assertEqual(len(api.calls), 1)

    def test_storage_sends_files_over_the_single_request_size_in_parts(self):
        api = FakeApi()
        storage = WorkerArchiveStorage(api, single_upload_bytes=20)
        small = temp_file(20)
        large = temp_file(21)
        try:
            self.assertTrue(storage.store(SHA, small, 20, "application/pdf", "pdf").get("single"))
            self.assertEqual(api.calls[-1]["path"], f"/archive/{SHA}")
            self.assertEqual(storage.store(SHA, large, 21, "application/pdf", "pdf")["status"], "archived")
            self.assertTrue(api.calls[-1]["path"].endswith("/complete"))
        finally:
            os.unlink(small)
            os.unlink(large)


if __name__ == "__main__":
    unittest.main()
