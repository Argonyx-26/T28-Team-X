import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR") or BACKEND_DIR.parent / "data"))
    db_path: Path = field(default_factory=lambda: Path(_env("DB_PATH") or BACKEND_DIR / "gurugraph.db"))
    # live: call providers; cached: serve only from the LLM cache or templates (offline demo)
    demo_mode: str = field(default_factory=lambda: _env("DEMO_MODE", "live"))
    admin_token: str = field(default_factory=lambda: _env("ADMIN_TOKEN", "dev-admin"))

    nebius_api_key: str = field(default_factory=lambda: _env("NEBIUS_API_KEY"))
    nebius_base_url: str = field(
        default_factory=lambda: _env("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1")
    )
    nebius_model: str = field(default_factory=lambda: _env("NEBIUS_MODEL", "Qwen/Qwen3-235B-A22B-Instruct-2507"))
    nebius_vision_model: str = field(default_factory=lambda: _env("NEBIUS_VISION_MODEL"))

    gcp_project: str = field(default_factory=lambda: _env("GCP_PROJECT") or _env("GOOGLE_CLOUD_PROJECT"))
    gcp_location: str = field(default_factory=lambda: _env("GCP_LOCATION", "global"))
    # text: fast structured JSON; vision: best at reading handwriting (measured on-site)
    vertex_model: str = field(default_factory=lambda: _env("VERTEX_MODEL", "gemini-2.5-flash"))
    vertex_vision_model: str = field(default_factory=lambda: _env("VERTEX_VISION_MODEL", "gemini-3-flash-preview"))
    vertex_hedge_model: str = field(default_factory=lambda: _env("VERTEX_HEDGE_MODEL", "gemini-2.5-flash"))
    hedge_after_s: float = field(default_factory=lambda: float(_env("HEDGE_AFTER_S", "6")))

    text_timeout_s: float = field(default_factory=lambda: float(_env("TEXT_TIMEOUT_S", "15")))
    photo_timeout_s: float = field(default_factory=lambda: float(_env("PHOTO_TIMEOUT_S", "20")))

    public_app_url: str = field(default_factory=lambda: _env("PUBLIC_APP_URL", "http://localhost:3000"))
    video_url: str = field(default_factory=lambda: _env("VIDEO_URL"))
    repo_url: str = field(default_factory=lambda: _env("REPO_URL", "https://github.com/Argonyx-26/T28-Team-X"))
    status_page_url: str = field(default_factory=lambda: _env("STATUS_PAGE_URL"))

    quiz_length: int = 5
    version: str = "0.1.0"


settings = Settings()
