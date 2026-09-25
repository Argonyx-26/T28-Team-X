"""One entry point for every LLM call: generate(). Primary provider, then fallback, then None.

Nebius Token Factory (OpenAI-compatible) and Gemini on Vertex AI. Every call returns telemetry the UI shows.
Successful results are cached, and DEMO_MODE=cached serves only from the cache.
"""

import asyncio
import base64
import hashlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TypeVar

import httpx
from pydantic import BaseModel

from ..config import settings
from ..db import get_conn

log = logging.getLogger("gurugraph.llm")

T = TypeVar("T", bound=BaseModel)

INR_PER_USD = 88.0
# USD per 1M tokens [input, output], by model, then by provider. Check these against the provider consoles.
PRICES: dict[str, tuple[float, float]] = {
    "gemini-3-flash-preview": (0.50, 3.00),
    "gemini-2.5-flash": (0.30, 2.50),
    "nebius": (0.20, 0.60),
    "vertex": (0.50, 3.00),
}

# (text, (in_tokens, out_tokens), model)
Caller = Callable[[str, str, type[BaseModel], bytes | None, str], Awaitable[tuple[str, tuple[int, int], str]]]

_nebius_transport: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport here
_vertex_client = None


def cost_paise(provider: str, model: str, in_tokens: int, out_tokens: int) -> float:
    p_in, p_out = PRICES.get(model) or PRICES.get(provider, (0.0, 0.0))
    return round((in_tokens * p_in + out_tokens * p_out) / 1e6 * INR_PER_USD * 100, 3)


def strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


async def _call_nebius(system: str, prompt: str, schema: type[BaseModel], image: bytes | None, mime: str):
    model = settings.nebius_vision_model if image else settings.nebius_model
    json_schema = json.dumps(schema.model_json_schema())
    text = f"{prompt}\n\nReturn only one JSON object that matches this JSON schema:\n{json_schema}"
    content: str | list = text
    if image:
        url = f"data:{mime};base64,{base64.b64encode(image).decode()}"
        content = [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": url}}]
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
        "temperature": 0.2,
        "max_tokens": 1500,
        "response_format": {"type": "json_object"},
    }
    async with httpx.AsyncClient(timeout=60, transport=_nebius_transport) as client:
        r = await client.post(
            f"{settings.nebius_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.nebius_api_key}"},
            json=body,
        )
    r.raise_for_status()
    data = r.json()
    usage = data.get("usage") or {}
    out = data["choices"][0]["message"]["content"] or ""
    return out, (int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))), model


def _get_vertex_client():
    global _vertex_client
    if _vertex_client is None:
        from google import genai

        _vertex_client = genai.Client(vertexai=True, project=settings.gcp_project, location=settings.gcp_location)
    return _vertex_client


async def _call_vertex(system: str, prompt: str, schema: type[BaseModel], image: bytes | None, mime: str):
    from google.genai import types

    client = _get_vertex_client()
    contents: list = []
    if image:
        contents.append(types.Part.from_bytes(data=image, mime_type=mime))
    contents.append(prompt)
    config = types.GenerateContentConfig(
        system_instruction=system,
        temperature=0.2,
        response_mime_type="application/json",
        response_schema=schema,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    model = settings.vertex_vision_model if image else settings.vertex_model
    resp = await client.aio.models.generate_content(model=model, contents=contents, config=config)
    usage = resp.usage_metadata
    in_t = int(getattr(usage, "prompt_token_count", 0) or 0)
    out_t = int(getattr(usage, "candidates_token_count", 0) or 0) + int(getattr(usage, "thoughts_token_count", 0) or 0)
    return resp.text or "", (in_t, out_t), model


CALLERS: dict[str, Caller] = {"nebius": _call_nebius, "vertex": _call_vertex}


def available(provider: str, image: bool) -> bool:
    if provider == "nebius":
        return bool(settings.nebius_api_key) and (not image or bool(settings.nebius_vision_model))
    if provider == "vertex":
        return bool(settings.gcp_project)
    return provider in CALLERS


def providers_status() -> dict[str, bool]:
    return {"nebius": available("nebius", False), "vertex": available("vertex", False)}


def _cache_key(agent: str, action: str, system: str, prompt: str, image: bytes | None, schema: type[BaseModel]) -> str:
    h = hashlib.sha256()
    for part in (agent, action, system, prompt, schema.__name__):
        h.update(part.encode())
        h.update(b"\x00")
    if image:
        h.update(hashlib.sha256(image).digest())
    return h.hexdigest()


def _cache_get(key: str) -> dict | None:
    with get_conn() as conn:
        r = conn.execute("SELECT provider, model, response_json FROM llm_cache WHERE key = ?", (key,)).fetchone()
        return dict(r) if r else None


def _cache_put(key: str, agent: str, provider: str, model: str, response_json: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO llm_cache (key, agent, provider, model, response_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (key, agent, provider, model, response_json, datetime.now(UTC).isoformat(timespec="seconds")),
        )


def _telemetry(agent, action, provider, model, ms, in_t, out_t, *, fallback, cached, ok) -> dict:
    return {
        "agent": agent,
        "action": action,
        "provider": provider,
        "model": model,
        "ms": int(ms),
        "in_tokens": in_t,
        "out_tokens": out_t,
        "cost_paise": 0.0 if cached else cost_paise(provider, model, in_t, out_t),
        "fallback": fallback,
        "cached": cached,
        "ok": ok,
    }


async def generate(
    agent: str,
    action: str,
    system: str,
    prompt: str,
    schema: type[T],
    *,
    image: bytes | None = None,
    image_mime: str = "image/jpeg",
    route: tuple[str, ...] = ("nebius", "vertex"),
    timeout: float | None = None,
    use_cache: bool = True,
    validate: Callable[[T], bool] | None = None,
) -> tuple[T | None, list[dict]]:
    """Try each provider in `route` once. Returns (parsed result or None, telemetry for every attempt)."""
    key = _cache_key(agent, action, system, prompt, image, schema)
    if use_cache:
        hit = _cache_get(key)
        if hit:
            try:
                parsed = schema.model_validate_json(hit["response_json"])
                return parsed, [
                    _telemetry(
                        agent, action, hit["provider"], hit["model"], 0, 0, 0, fallback=False, cached=True, ok=True
                    )
                ]
            except ValueError:
                pass
    if settings.demo_mode == "cached":
        return None, []

    timeout = timeout or (settings.photo_timeout_s if image else settings.text_timeout_s)
    telemetry: list[dict] = []
    for provider in route:
        if not available(provider, image is not None):
            continue
        start = time.perf_counter()
        if provider == "vertex":
            model = settings.vertex_vision_model if image else settings.vertex_model
        else:
            model = settings.nebius_vision_model if image else settings.nebius_model
        try:
            text, (in_t, out_t), model = await asyncio.wait_for(
                CALLERS[provider](system, prompt, schema, image, image_mime), timeout
            )
            parsed = schema.model_validate_json(strip_fences(text))
            if validate and not validate(parsed):
                raise ValueError("output failed validation")
        except Exception as exc:  # any provider failure degrades to the next provider
            log.warning("%s %s via %s failed: %s", agent, action, provider, repr(exc)[:300])
            telemetry.append(
                _telemetry(
                    agent,
                    action,
                    provider,
                    model,
                    (time.perf_counter() - start) * 1000,
                    0,
                    0,
                    fallback=bool(telemetry),
                    cached=False,
                    ok=False,
                )
            )
            continue
        ms = (time.perf_counter() - start) * 1000
        telemetry.append(
            _telemetry(agent, action, provider, model, ms, in_t, out_t, fallback=bool(telemetry), cached=False, ok=True)
        )
        if use_cache:
            _cache_put(key, agent, provider, model, parsed.model_dump_json())
        return parsed, telemetry
    return None, telemetry
