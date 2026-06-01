# 🦖 DinoQuest V2 (Enterprise Architecture)

This repository contains the refactored, enterprise-grade architecture for DinoQuest! 
To resolve fundamental security vulnerabilities (like leaked API keys and unrestricted client generation), the architecture has been strictly decoupled during development into two isolated zones, but unified into a High-Performance Monolithic Execution Gateway for deployment.

1. **Frontend (React/Vite)**: A lightweight presentation UI client that completely lacks Google GenAI SDK integrations.
2. **Backend (Python FastAPI)**: A secure Python-driven execution proxy that safely protects Google API execution keys dynamically, and seamlessly intercepts URL requests to physically serve the compiled React Frontend cleanly.

---

## 🏃 Local Execution Guide (Unified Server)

Because we re-routed the local environment to operate entirely out of Python via `FastAPI`, executing this massive environment locally requires exactly 1 shell command. 
Running this script natively triggers `npm run build` mechanically in the background before securely handing control of the terminal instantly over to Python!

```bash
cd /Users/linchr/Desktop/work/DinoQuest2
./start.sh
```

*Navigate to `http://localhost:8000` inside your Web Browser! You are now fetching Vite Static UI bytes strictly through Python logic!*

---

## ☁️ Google Cloud Run Deployment Guide

Because the backend cleanly serves the static frontend, we only require **one single container** to run securely in production! I have already generated the multi-stage `Dockerfile` required natively in the root directory.

Run these exact identical bash commands structurally inside an authenticated Google Cloud SDK Terminal to containerize and instantly deploy this architecture to Google Cloud!

```bash
# 1. Provide your authenticated Google Cloud Project ID
PROJECT_ID="dyno-test-3fc51"

# 2. Mechanically execute Google Cloud Build to construct the Multi-Stage Docker Protocol remotely
gcloud builds submit --tag gcr.io/$PROJECT_ID/dino-quest

gcloud builds submit --tag gcr.io/$PROJECT_ID/dinoquest2

# 3. Deploy the finalized Image completely natively into Google Cloud Run Serverless!
# Vertex AI mode uses the Cloud Run service account instead of a GEMINI_API_KEY.

gcloud run deploy dino-quest \
  --image gcr.io/$PROJECT_ID/dino-quest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=us-central1"


gcloud run deploy dinoquest2 \
  --image gcr.io/$PROJECT_ID/dinoquest2 \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=us-central1"



```

Once the container finishes booting, Google Cloud Run will instantly dispense your production HTTPS URL publicly on the internet!

