"""List the Gemini models your API key (or Google Cloud project) can use, and optionally test which answer right now.

Use it to choose GEMINI_MODEL and GEMINI_FALLBACK_MODEL in .env when a model is
busy (503) or over your quota (429). Quotas are per model, so a model you have
not used today often still works.

Run:
  python tools/list_models.py            # models that can generate content
  python tools/list_models.py --ping     # also send one tiny request to each flash model
  python tools/list_models.py --ping all # ... to every listed model (uses one request each)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_settings  # noqa: E402
from app.gemini import make_client  # noqa: E402


def main() -> int:
    settings = load_settings()
    if not settings.has_credentials:
        print("No credentials: set GEMINI_API_KEY, or GOOGLE_GENAI_USE_ENTERPRISE=true with GOOGLE_CLOUD_PROJECT.")
        return 1

    from google.genai import errors, types

    client = make_client(settings)  # no retries: report the first answer
    print(f"Backend: {settings.backend_label}")
    models = []
    for m in client.models.list():
        # Google Cloud lists publisher models without supported_actions; keep the Gemini ones.
        if "generateContent" in (m.supported_actions or []) or (
                settings.backend == "cloud" and "gemini" in (m.name or "")):
            models.append(m)
    models.sort(key=lambda m: m.name)
    if not models:
        print("The key works, but it lists no models that can generate content.")
        return 1

    ping = "--ping" in sys.argv
    ping_all = ping and "all" in sys.argv
    print(f"Configured: GEMINI_MODEL={settings.gemini_model}  GEMINI_FALLBACK_MODEL={settings.gemini_fallback_model}\n")
    print(f"{'model id':44} {'status':22} display name")
    for m in models:
        mid = m.name.removeprefix("models/").removeprefix("publishers/google/models/")
        status = ""
        if ping and (ping_all or "flash" in mid):
            try:
                client.models.generate_content(
                    model=mid, contents="Reply with the word OK.",
                    config=types.GenerateContentConfig(max_output_tokens=16),
                )
                status = "answers now"
            except errors.APIError as e:
                status = {429: "429 over quota", 503: "503 overloaded", 404: "404 not available"}.get(
                    e.code, f"{e.code} {e.status}")
            except Exception as e:  # network
                status = type(e).__name__
        mark = " *" if mid in settings.model_chain else ""
        print(f"{mid + mark:44} {status:22} {m.display_name or ''}")

    print("\n* = in your current model chain.")
    print("To switch, edit .env, for example:")
    print("  GEMINI_MODEL=<a model that answers now>")
    print("  GEMINI_FALLBACK_MODEL=<second choice>,<third choice>")
    print("then restart the server. Charts record which model read them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
