import asyncio
import json

import httpx
from pydantic import BaseModel

from app.config import settings
from app.db import init_db
from app.llm import providers


class Out(BaseModel):
    answer: str


def test_nebius_call_parses_fenced_json_and_usage(monkeypatch):
    init_db()
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        body = json.loads(request.content)
        assert body["response_format"] == {"type": "json_object"}
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '```json\n{"answer": "4/4"}\n```'}}],
                "usage": {"prompt_tokens": 120, "completion_tokens": 8},
            },
        )

    monkeypatch.setattr(providers, "_nebius_transport", httpx.MockTransport(handler))
    monkeypatch.setitem(providers.CALLERS, "nebius", providers._call_nebius)
    result, tel = asyncio.run(
        providers.generate("Test", "ping", "sys", "3/4 + 1/4?", Out, route=("nebius",), use_cache=False)
    )
    assert result.answer == "4/4"
    assert seen["url"].endswith("/chat/completions") and seen["auth"] == "Bearer test-key"
    assert tel[0]["provider"] == "nebius" and tel[0]["in_tokens"] == 120 and tel[0]["cost_paise"] > 0


def test_failed_provider_falls_back_and_says_so(monkeypatch):
    init_db()

    async def broken(*args, **kwargs):
        raise httpx.ConnectError("down")

    monkeypatch.setitem(providers.CALLERS, "nebius", broken)
    result, tel = asyncio.run(
        providers.generate(
            "Test", "fb", "sys", "p", Out, route=("nebius", "vertex"), use_cache=False, validate=lambda r: True
        )
    )
    assert tel[0]["ok"] is False and tel[1]["ok"] is True and tel[1]["fallback"] is True


def test_hedge_takes_the_first_valid_answer(monkeypatch):
    init_db()

    async def slow(*args, **kwargs):
        await asyncio.sleep(1)
        return json.dumps({"answer": "slow"}), (1, 1), "slow-model"

    async def fast(*args, **kwargs):
        return json.dumps({"answer": "fast"}), (1, 1), "fast-model"

    monkeypatch.setitem(providers.CALLERS, "vertex", slow)
    monkeypatch.setitem(providers.CALLERS, "vertex_alt", fast)
    result, tel = asyncio.run(
        providers.generate_hedged(
            "Test",
            "hedge",
            "sys",
            "p",
            Out,
            primary=("vertex",),
            backup=("vertex_alt",),
            hedge_after=0.05,
            use_cache=False,
        )
    )
    assert result.answer == "fast" and tel[0]["model"] == "fast-model" and tel[0]["provider"] == "vertex"


def test_cache_then_cached_demo_mode(monkeypatch):
    init_db()
    first, _ = asyncio.run(providers.generate("Test", "cache", "sys", "same prompt", Out, route=("vertex",)))
    monkeypatch.setattr(settings, "demo_mode", "cached")
    again, tel = asyncio.run(providers.generate("Test", "cache", "sys", "same prompt", Out, route=("vertex",)))
    assert again == first and tel[0]["cached"] and tel[0]["cost_paise"] == 0
    missing, tel = asyncio.run(providers.generate("Test", "cache", "sys", "new prompt", Out, route=("vertex",)))
    assert missing is None and tel == []
