"""Demo ingestion: archive decompression (.zst/.gz) and saving into uploads.

demo_id derives from the *decompressed* name+size, so `foo.dem.zst` dedups
against a plain `foo.dem` upload of the same content.
"""
import gzip
import io
import os

from . import config, storage

try:
    import zstandard
except ImportError:  # .zst uploads degrade to a clear error instead of a crash
    zstandard = None

CHUNK = 1 << 20


def is_supported(name: str) -> bool:
    low = name.lower()
    return low.endswith((".dem", ".dem.zst", ".zst", ".dem.gz", ".gz"))


def strip_archive_suffix(name: str) -> str:
    low = name.lower()
    for suf in (".dem.zst", ".dem.gz", ".zst", ".gz"):
        if low.endswith(suf):
            return name[: -len(suf)] + ".dem"
    return name


def _read_capped(reader, limit: int) -> bytes:
    chunks, total = [], 0
    while True:
        chunk = reader.read(CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise ValueError("decompressed demo too large")
        chunks.append(chunk)
    return b"".join(chunks)


def decompress(name: str, raw: bytes) -> bytes:
    low = name.lower()
    if low.endswith(".zst"):
        if zstandard is None:
            raise RuntimeError("zstandard package is not installed")
        return _read_capped(zstandard.ZstdDecompressor().stream_reader(io.BytesIO(raw)),
                            config.MAX_UPLOAD_BYTES)
    if low.endswith(".gz"):
        return _read_capped(gzip.GzipFile(fileobj=io.BytesIO(raw)), config.MAX_UPLOAD_BYTES)
    return raw


def save_demo(name: str, raw: bytes) -> tuple[str, str, int]:
    """Store a demo (decompressing archives) as uploads/<did>.dem.

    Returns (demo_id, display_name, stored_size). Atomic write via .part + rename.
    """
    data = decompress(name, raw)
    base = os.path.basename(strip_archive_suffix(name))
    did = storage.demo_id(base, len(data))
    dest = os.path.join(config.UPLOADS_DIR, did + ".dem")
    tmp = dest + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, dest)
    return did, base, len(data)
