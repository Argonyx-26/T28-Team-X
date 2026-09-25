import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import seed
from .api import router
from .config import settings
from .db import init_db
from .errors import ApiError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("gurugraph")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if seed.seed():
        log.info("seeded class 7B")
    yield


app = FastAPI(title="GuruGraph API", version=settings.version, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def no_store(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


@app.exception_handler(ApiError)
async def api_error(_: Request, exc: ApiError):
    return _error(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    return _error(422, "invalid_request", f"{where}: {first.get('msg', 'invalid input')}".strip(": "))


@app.exception_handler(Exception)
async def unexpected(_: Request, exc: Exception):
    log.exception("unhandled error", exc_info=exc)
    return _error(500, "internal", "Something went wrong on our side. Please try again.")


app.include_router(router)
