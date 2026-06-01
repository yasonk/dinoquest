from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from google import genai
from google.genai import types
from typing import Optional
import os
import json
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth

ADMIN_EMAILS = [
    email.strip() for email in os.getenv("ADMIN_EMAILS", "").split(",") if email.strip()
]
LEADERBOARD_ENABLED = os.getenv("LEADERBOARD_ENABLED", "false").lower() == "true"
TEXT_MODEL = os.getenv("DINOQUEST_TEXT_MODEL", "gemini-2.5-flash")
IMAGE_MODEL = os.getenv("DINOQUEST_IMAGE_MODEL", "gemini-2.5-flash-image")

# Load sensitive environment variables securely
load_dotenv()


def parse_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def build_genai_client() -> genai.Client:
    use_vertexai = parse_bool_env("GOOGLE_GENAI_USE_VERTEXAI", default=False)
    api_key = os.getenv("GEMINI_API_KEY")
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    location = os.getenv("GOOGLE_CLOUD_LOCATION")
    http_options = types.HttpOptions(
        retry_options=types.HttpRetryOptions(
            initial_delay=1.0,
            attempts=5,
            http_status_codes=[408, 429, 500, 502, 503, 504],
        ),
        timeout=120 * 1000,
    )

    if use_vertexai:
        if api_key:
            raise ValueError(
                "Vertex AI mode is enabled, but GEMINI_API_KEY is also set. "
                "Unset GEMINI_API_KEY when using Vertex AI."
            )
        if not project:
            raise ValueError(
                "Vertex AI mode requires GOOGLE_CLOUD_PROJECT to be set."
            )
        if not location:
            raise ValueError(
                "Vertex AI mode requires GOOGLE_CLOUD_LOCATION (for example us-central1)."
            )

        print(
            f"Initializing Google GenAI client in Vertex AI mode "
            f"(project={project}, location={location}, text_model={TEXT_MODEL}, image_model={IMAGE_MODEL})",
            flush=True,
        )
        return genai.Client(
            vertexai=True,
            project=project,
            location=location,
            http_options=http_options,
        )

    if not api_key:
        raise ValueError(
            "API key mode requires GEMINI_API_KEY to be set in backend/.env or the shell environment."
        )

    print(
        f"Initializing Google GenAI client in API key mode "
        f"(text_model={TEXT_MODEL}, image_model={IMAGE_MODEL})",
        flush=True,
    )
    return genai.Client(api_key=api_key, http_options=http_options)


def clamp_stat(value, default: int) -> int:
    try:
        numeric_value = int(round(float(value)))
    except (TypeError, ValueError):
        return default
    return max(1, min(10, numeric_value))


def normalize_dino_details(details: dict, request: "GenerationRequest") -> dict:
    stats = details.get("stats")
    if not isinstance(stats, dict):
        stats = {}

    normalized_stats = {
        "speed": clamp_stat(stats.get("speed", details.get("speed")), 6),
        "health": clamp_stat(stats.get("health", details.get("health")), 6),
        "jump": clamp_stat(stats.get("jump", details.get("jump")), 6),
    }

    return {
        "name": details.get("name") or "Mystery Dino",
        "habitat": details.get("habitat") or request.habitat,
        "diet": details.get("diet") or request.diet,
        "type": details.get("type") or "Balanced",
        "description": details.get("description")
        or "A friendly dinosaur ready for adventure.",
        "stats": normalized_stats,
        "imagePrompt": details.get("imagePrompt")
        or "A cute, friendly dinosaur with vibrant colors.",
    }


# Initialize Firebase Admin for the backend
if not firebase_admin._apps:
    firebase_admin.initialize_app()
db = firestore.client()
client = build_genai_client()

# Initialize FastAPI application
app = FastAPI(title="DinoQuest Secure Backend")

# Securely configure CORS to accept traffic exclusively from the React frontend port
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Explicitly permit Firebase OAuth Popups to communicate with the main window
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    return response


class GenerationRequest(BaseModel):
    habitat: str
    diet: str
    preferences: str
    userId: Optional[str] = None


class GameStartLog(BaseModel):
    userId: Optional[str] = None
    dino_type: str
    dino_name: str
    is_reuse: bool


class GameEndLog(BaseModel):
    userId: Optional[str] = None
    dino_type: str
    dino_name: str
    score: int
    coins: int
    won: bool
    speed: float


@app.post("/api/generate")
async def generate_dinosaur(request: GenerationRequest):
    try:
        # 1. Generate text details
        text_prompt = f"""Generate a unique dinosaur character for a kid's game.
        Habitat: {request.habitat}
        Diet: {request.diet}
        Preferences: {request.preferences}
        
        The dinosaur should have a name, a short educational description, and game stats (speed, health, jump) from 1 to 10.
        Assign it one of these types: Speedy, Tank, Balanced, Agile."""

        text_response = client.models.generate_content(
            model=TEXT_MODEL,
            contents=text_prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        # Robustly extract text content by filtering for parts that actually contain text
        text_content = "".join(
            part.text
            for part in text_response.candidates[0].content.parts
            if hasattr(part, "text") and part.text
        )
        details = normalize_dino_details(json.loads(text_content), request)
        image_prompt = details.get(
            "imagePrompt",
            "A cute, friendly dinosaur with vibrant colors and use a random color as base color if the user does not specify any color.",
        )

        # 2. Generate Image — include user preferences (e.g. color) directly in the prompt
        img_prompt = (
            f"A high-quality 3D render of a cute cartoon dinosaur for a modern 3D kids game. "
            f"{image_prompt}. User's special requests: {request.preferences}. "
            f"Art style: 3D CGI, Pixar Disney style, smooth vibrant materials, soft studio lighting, high resolution 3D game asset. "
            f"Pure white background. Just the dinosaur, no ground, no shadows on the floor, or other objects. "
            f"It is in a dynamic running pose and facing right. "
            f"CRITICAL: Keep the colors highly vibrant and ensure it has colorful spots. Do NOT make the skin bumpy or realistic."
        )

        image_response = client.models.generate_content(
            model=IMAGE_MODEL,
            contents=img_prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )

        # Extract base64 image bytes securely from the multimodal part, filtering for inline_data
        import base64

        image_part = next(
            (
                part
                for part in image_response.candidates[0].content.parts
                if hasattr(part, "inline_data") and part.inline_data
            ),
            None,
        )

        if not image_part:
            raise ValueError("No image data found in the multimodal response.")

        base64_img = base64.b64encode(image_part.inline_data.data).decode("utf-8")
        raw_image_url = f"data:{image_part.inline_data.mime_type};base64,{base64_img}"

        # Log creation telemetry for Log Router -> BigQuery analysis
        print(
            json.dumps(
                {
                    "event": "DINO_CREATED",
                    "userId": request.userId,
                    "habitat": request.habitat,
                    "diet": request.diet,
                    "preferences": request.preferences,
                    "generated_name": details.get("name"),
                    "generated_type": details.get("type"),
                    "generated_description": details.get("description"),
                    "speed_stat": details.get("stats", {}).get("speed")
                    if "stats" in details
                    else None,
                }
            ),
            flush=True,
        )

        # Return merged payload identically format to what the frontend expects
        return {"details": details, "rawImageUrl": raw_image_url}

    except Exception as e:
        print(f"Backend Generation Error: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to securely generate Dinosaur payload."
        )


# ====================================================================
# TELEMETRY LOGGING ENDPOINTS
# ====================================================================


@app.post("/api/log/game_start")
async def log_game_start(log_data: GameStartLog):
    print(
        json.dumps(
            {
                "event": "GAME_START",
                "userId": log_data.userId,
                "dino_type": log_data.dino_type,
                "dino_name": log_data.dino_name,
                "is_reuse": log_data.is_reuse,
            }
        ),
        flush=True,
    )
    return {"status": "logged"}


@app.post("/api/log/game_end")
async def log_game_end(log_data: GameEndLog):
    print(
        json.dumps(
            {
                "event": "GAME_END",
                "userId": log_data.userId,
                "dino_type": log_data.dino_type,
                "dino_name": log_data.dino_name,
                "score": log_data.score,
                "coins": log_data.coins,
                "won": log_data.won,
                "speed": log_data.speed,
            }
        ),
        flush=True,
    )
    return {"status": "logged"}


# ====================================================================
# LEADERBOARD (OOM DEMO VIBE-CODED ENDPOINT)
# ====================================================================


@app.get("/api/leaderboard/status")
async def get_leaderboard_status(authorization: str = Header(None)):
    is_admin = False
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ")[1]
        try:
            decoded = fb_auth.verify_id_token(token)
            if decoded.get("email") in ADMIN_EMAILS:
                is_admin = True
        except Exception:
            pass

    return {"enabled": LEADERBOARD_ENABLED, "isAdmin": is_admin}


@app.get("/api/leaderboard")
async def get_leaderboard(authorization: str = Header(None)):
    """
    Vibe-coded mistake: Fetching all documents at once without pagination or limits.

    Works perfectly with 5000 records.
    Causes an immediate Out-Of-Memory (OOM) crash in Cloud Run when the
    collection has 50,000+ records and container memory is low (e.g. 512MB).
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")

    token = authorization.split("Bearer ")[1]
    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    is_admin = decoded.get("email") in ADMIN_EMAILS
    if not LEADERBOARD_ENABLED and not is_admin:
        raise HTTPException(status_code=403, detail="Leaderboard is currently disabled")

    # Load ALL documents into memory at once
    docs = db.collection("scores").get()

    scores = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        # Vibe-coding mistake: The developer attempts to inject an empty 'replay_frames' buffer for the frontend.
        # Ensure allocating a unique string per document so it literally consumes RAM!
        data["replay_frames"] = "x" * 20000000 + str(doc.id)
        scores.append(data)

    # Sort in-memory (adding further memory/CPU pressure)
    scores.sort(key=lambda x: x.get("score", 0), reverse=True)

    # Only return top 100, masking the fact we loaded 50,000 into memory
    return {"status": "success", "leaderboard": scores[:100]}


# ====================================================================
# STATIC REACT FRONTEND INTEGRATION
# ====================================================================


# Silence favicon logs and prevent serving HTML as an image
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi import Response

    return Response(status_code=204)


# 1. Provide absolute direct access internally to the Vite compiled assets
app.mount("/assets", StaticFiles(directory="../frontend/dist/assets"), name="assets")


# 2. Establish a Catch-All mechanism for React-Router SPAs
@app.get("/{full_path:path}")
async def serve_react_app(full_path: str, request: Request):
    import os

    target_path = f"../frontend/dist/{full_path}"

    # If the user asks for a specific root file (like vite.svg), serve it
    if os.path.exists(target_path) and os.path.isfile(target_path):
        return FileResponse(target_path)

    # Otherwise, fallback gracefully explicitly to index.html and let React build the UI!
    return FileResponse("../frontend/dist/index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
