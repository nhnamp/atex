"""
OMR Flask Server — HTTP API for the Python OMR service.

Endpoints:
  GET  /api/omr/health       → { "status": "ok" }
  POST /api/omr/process      → { "studentCode": ..., "answers": ..., "mcqLayout": ..., "confidence": ..., "warnings": [...] }
"""

import os
import sys
import tempfile
import traceback
from flask import Flask, request, jsonify

# Add current directory to path for local imports.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from omr_processor import process_omr_image

app = Flask(__name__)

# Configuration
PORT = int(os.environ.get("OMR_SERVICE_PORT", 5001))
MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50 MB max upload
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


@app.route("/api/omr/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok", "service": "omr-python"})


@app.route("/api/omr/process", methods=["POST"])
def process():
    """
    Process a single exam scan image for OMR.

    Accepts multipart/form-data with:
      - image: the scan image file
      - total_questions (optional): number of MCQ questions (default 52)

    Returns JSON:
      {
        "studentCode": "22521000" | null,
        "answers": { "1": "A", "2": "C", ... },
        "mcqLayout": { "referenceWidth": 800, "referenceHeight": 1131, "questions": [...] },
        "identityLayout": { "referenceWidth": 800, "referenceHeight": 1131, "digits": [...] },
        "confidence": 0.92,
        "warnings": ["..."]
      }
    """
    if "image" not in request.files:
        return jsonify({"error": "No image file provided", "studentCode": None, "answers": {}, "confidence": 0.0, "warnings": ["No image file in request"]}), 400

    image_file = request.files["image"]
    if not image_file.filename:
        return jsonify({"error": "Empty filename", "studentCode": None, "answers": {}, "confidence": 0.0, "warnings": ["Empty filename"]}), 400

    total_questions = request.form.get("total_questions", 52, type=int)

    # Save uploaded file to a temp location.
    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, image_file.filename)

    try:
        image_file.save(temp_path)
        result = process_omr_image(temp_path, total_questions)

        student_code = result.get("studentCode")
        confidence = result.get("confidence", 0.0)
        answer_count = len(result.get("answers") or {})
        warnings_count = len(result.get("warnings") or [])
        source_name = image_file.filename or "uploaded_image"

        if student_code:
            print(
                f"[OMR Service] Processed '{source_name}' -> studentCode={student_code}, "
                f"confidence={confidence}, answers={answer_count}, warnings={warnings_count}"
            )
        else:
            print(
                f"[OMR Service] Processed '{source_name}' -> studentCode=UNREADABLE, "
                f"confidence={confidence}, answers={answer_count}, warnings={warnings_count}"
            )

        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "error": str(e),
            "studentCode": None,
            "answers": {},
            "confidence": 0.0,
            "warnings": [f"OMR processing error: {str(e)}"],
        }), 500
    finally:
        # Clean up temp file.
        try:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            os.rmdir(temp_dir)
        except OSError:
            pass


if __name__ == "__main__":
    print(f"[OMR Service] Starting on port {PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=os.environ.get("OMR_DEBUG", "0") == "1")
