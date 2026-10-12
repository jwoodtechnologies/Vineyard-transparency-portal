import unittest

from ingest.__main__ import format_archive_size


class ArchiveSizeReportTest(unittest.TestCase):
    def test_prints_counts_bytes_and_cost(self):
        t = {"files": 3, "knownSizeFiles": 2, "knownBytes": 6000, "unknownSizeFiles": 1, "estimatedBytes": 2667, "totalBytes": 8667}
        report = {
            "stop": {"hardStopBytes": 60000000000, "ceilingBytes": 60000000000, "otherFilesStopBytes": 59500000000, "maxObjectBytes": 26214400, "maxLargeObjectBytes": 500000000},
            "uploadedInParts": {"files": 1, "totalBytes": 50000000, "knownSizeFiles": 1},
            "stored": {"bytes": 1000, "objects": 1},
            "remaining": t,
            "remainingPriority": t,
            "remainingOther": t,
            "remainingByType": {"minutes": t},
            "fitsUnderStop": t,
            "pastStop": {"files": 0, "totalBytes": 0},
            "overMaxObjectSize": {"files": 1, "totalBytes": 50000000, "knownSizeFiles": 1},
            "cost": {"thisBucketAllBytes": 9667, "thisBucketMonthlyUsd": 0, "otherBucketsBytesAssumed": 1700000000, "accountAllBytes": 1700009667, "accountMonthlyUsd": 0, "accountWithLargeFilesBytes": 1750009667, "accountWithLargeFilesMonthlyUsd": 0, "classAWritesNeeded": 3, "classAWritesFreePerMonth": 1000000, "pricePerGbMonth": 0.015, "atStopMonthlyUsd": 0.75},
        }
        out = format_archive_size(report)
        self.assertIn("Not stored yet: 3 files, 8,667 bytes (sizes known for 2; 1 estimated at 2,667 bytes)", out)
        self.assertIn("Stop: 60,000,000,000 bytes", out)
        self.assertIn("ceiling 60,000,000,000", out)
        self.assertIn("in parts up to 500,000,000 bytes", out)
        self.assertIn("uploaded in parts (over the one-request size): 1 files, 50,000,000 bytes", out)
        self.assertIn("Worst case, this bucket filled to the stop: $0.75 a month", out)
        self.assertIn("$0.00 a month", out)
        self.assertIn("Uploads needed: 3 Class A writes (free: 1,000,000 a month)", out)
        # No record titles: counts and bytes only.
        self.assertNotIn("title", out.split("\n\n")[0].lower())


if __name__ == "__main__":
    unittest.main()
