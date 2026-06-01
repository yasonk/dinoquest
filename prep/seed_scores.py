"""
Seed script: inserts 300 fake documents into the Firestore `scores` collection.

Usage:
  1. Authenticate with your project:
       gcloud auth application-default login
       gcloud config set project YOUR_PROJECT_ID
  2. Run:
       python prep/seed_scores.py --project YOUR_PROJECT_ID
"""

import argparse
import random
import uuid
import firebase_admin
from firebase_admin import firestore

DINO_TYPES = ["Speedy", "Tank", "Balanced", "Agile"]

DINO_NAMES = [
    "Blaze", "Chomper", "Dasher", "Echo", "Fern",
    "Glide", "Haze", "Iggy", "Jade", "Koa",
    "Lumi", "Mochi", "Nova", "Orbit", "Pip",
    "Quill", "Roco", "Sparky", "Thorn", "Uno",
]

USER_IDS = [f"user_{uuid.uuid4().hex[:8]}" for _ in range(20)]


def make_score_doc() -> dict:
    won = random.random() > 0.4
    return {
        "userId": random.choice(USER_IDS),
        "dino_type": random.choice(DINO_TYPES),
        "dino_name": random.choice(DINO_NAMES),
        "score": random.randint(0, 5),
        "coins": random.randint(0, 50),
        "won": won,
        "speed": round(random.uniform(1.0, 10.0), 2),
    }


def main():
    parser = argparse.ArgumentParser(description="Seed Firestore scores collection")
    parser.add_argument(
        "--project",
        help="Google Cloud project ID (overrides gcloud default)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=300,
        help="Number of seed documents to insert (default: 300)",
    )
    args = parser.parse_args()

    options = {"projectId": args.project} if args.project else {}
    firebase_admin.initialize_app(options=options)
    db = firestore.client()

    collection = db.collection("scores")
    batch = db.batch()

    for i in range(args.count):
        doc_ref = collection.document()
        batch.set(doc_ref, make_score_doc())
        # Firestore batches are limited to 500 ops; flush and start a new one
        if (i + 1) % 500 == 0:
            batch.commit()
            batch = db.batch()

    batch.commit()
    print(f"Inserted {args.count} seed documents into `scores`.")


if __name__ == "__main__":
    main()
