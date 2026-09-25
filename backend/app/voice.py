"""Parent voice notes: Google Cloud Text-to-Speech (Chirp 3 HD voices in Kannada, Hindi and Indian English)."""

import asyncio
import base64
import hashlib
import logging
import time
from collections import OrderedDict

import httpx

from .config import settings

log = logging.getLogger("gurugraph.voice")

VOICES = {
    "kn": ("kn-IN", "kn-IN-Chirp3-HD-Kore"),
    "hi": ("hi-IN", "hi-IN-Chirp3-HD-Kore"),
    "en": ("en-IN", "en-IN-Chirp3-HD-Kore"),
}
USD_PER_M_CHARS = 30.0  # Chirp 3 HD list price; check against the console
_clips: OrderedDict[str, bytes] = OrderedDict()
_pending: dict[str, asyncio.Task] = {}
_credentials = None


def _token() -> str:
    global _credentials
    import google.auth
    import google.auth.transport.requests

    if _credentials is None:
        _credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not _credentials.valid:
        _credentials.refresh(google.auth.transport.requests.Request())
    return _credentials.token


async def synthesize(text: str, language: str) -> bytes:
    code, name = VOICES.get(language, VOICES["en"])
    token = await asyncio.to_thread(_token)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://texttospeech.googleapis.com/v1/text:synthesize",
            headers={"Authorization": f"Bearer {token}", "x-goog-user-project": settings.gcp_project},
            json={
                "input": {"text": text},
                "voice": {"languageCode": code, "name": name},
                "audioConfig": {"audioEncoding": "MP3"},
            },
        )
    r.raise_for_status()
    return base64.b64decode(r.json()["audioContent"])


def _telemetry(name: str, text: str, ms: float, ok: bool) -> dict:
    cost = round(len(text) / 1e6 * USD_PER_M_CHARS * 88 * 100, 3) if ok else 0.0
    return {
        "agent": "Coach",
        "action": "voice_note",
        "provider": "google-tts",
        "model": name,
        "ms": int(ms),
        "in_tokens": len(text),
        "out_tokens": 0,
        "cost_paise": cost,
        "fallback": False,
        "cached": False,
        "ok": ok,
    }


async def _make(clip_id: str, text: str, language: str, on_done) -> bytes | None:
    name = VOICES.get(language, VOICES["en"])[1]
    start = time.perf_counter()
    try:
        audio = await synthesize(text, language)
    except Exception as exc:
        log.warning("voice note failed: %r", exc)
        on_done(_telemetry(name, text, (time.perf_counter() - start) * 1000, False))
        return None
    _clips[clip_id] = audio
    while len(_clips) > 200:
        _clips.popitem(last=False)
    on_done(_telemetry(name, text, (time.perf_counter() - start) * 1000, True))
    return audio


def voice_note(text: str, language: str, on_done) -> str | None:
    """Starts the voice note in the background and returns its API-relative URL at once.

    The same text in the same voice reuses the clip. `on_done(telemetry)` runs when synthesis finishes.
    Fetching the URL waits for synthesis to finish, so an <audio> tag can point at it immediately.
    """
    if settings.demo_mode == "cached" or not settings.gcp_project:
        return None
    clip_id = hashlib.sha256(f"{VOICES.get(language, VOICES['en'])[1]}|{text}".encode()).hexdigest()[:16]
    if clip_id not in _clips and clip_id not in _pending:
        _pending[clip_id] = asyncio.create_task(_make(clip_id, text, language, on_done))
    return f"/media/voice?id={clip_id}"


async def clip(clip_id: str) -> bytes | None:
    if clip_id in _clips:
        return _clips[clip_id]
    task = _pending.get(clip_id)
    if task is None:
        return None
    try:
        return await asyncio.wait_for(asyncio.shield(task), 20)
    except TimeoutError:
        return None
    finally:
        if task.done():
            _pending.pop(clip_id, None)
