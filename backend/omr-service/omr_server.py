"""
OMR Flask Server — HTTP API for the Python OMR service.

Endpoints:
  GET  /api/omr/health   -> { "status": "ok" }
  POST /api/omr/process  -> { "studentCode", "answers", "mcqLayout",
                              "identityLayout", "confidence", "aligned",
                              "warnings", "resultImage"? }

POST form fields (multipart/form-data):
  image            (required) the scan image file
  total_questions  (optional) number of MCQ questions (default 20)
  identity_only    (optional) "1"/"true" to skip MCQ reading for fast live probes
  answer_key       (optional) correct answers, e.g. "aabbccddaabbbbaaccdd";
                   when given, the graded result image marks correct answers
  return_image     (optional) "1"/"true" to include the annotated result image
                   as a base64 PNG under "resultImage"
"""

import base64
import os
import sys
import tempfile
import traceback

import cv2
from flask import Flask, request, jsonify

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from omr_processor import process_omr_image

app = Flask(__name__)

PORT = int(os.environ.get("OMR_SERVICE_PORT", 5001))
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB max upload


@app.route("/api/omr/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "omr-python"})


def _truthy(value):
    return str(value).lower() in ("1", "true", "yes", "on")


@app.route("/api/omr/process", methods=["POST"])
def process():
    if "image" not in request.files:
        return jsonify({"error": "No image file provided", "studentCode": None,
                        "answers": {}, "confidence": 0.0,
                        "warnings": ["No image file in request"]}), 400

    image_file = request.files["image"]
    if not image_file.filename:
        return jsonify({"error": "Empty filename", "studentCode": None,
                        "answers": {}, "confidence": 0.0,
                        "warnings": ["Empty filename"]}), 400

    total_questions = request.form.get("total_questions", 20, type=int)
    identity_only = _truthy(request.form.get("identity_only", "0"))
    answer_key = request.form.get("answer_key") or None
    return_image = _truthy(request.form.get("return_image", "0"))

    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, image_file.filename)
    out_path = os.path.join(temp_dir, "result.png") if (return_image or (answer_key and not identity_only)) else None

    try:
        image_file.save(temp_path)
        result = process_omr_image(temp_path, total_questions,
                                   answer_key=answer_key,
                                   output_image_path=out_path,
                                   identity_only=identity_only)

        if return_image and out_path and os.path.exists(out_path):
            img = cv2.imread(out_path)
            ok, buf = cv2.imencode(".png", img)
            if ok:
                result["resultImage"] = "data:image/png;base64," + \
                    base64.b64encode(buf.tobytes()).decode("ascii")
        else:
            # Don't leak a server-local path to the client.
            result.pop("resultImage", None)

        code = result.get("studentCode")
        print(f"[OMR Service] '{image_file.filename}' -> studentCode={code or 'UNREADABLE'}, "
              f"aligned={result.get('aligned')}, mode={'identity' if identity_only else 'full'}, "
              f"answers={len(result.get('answers') or {})}, "
              f"warnings={len(result.get('warnings') or [])}")
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e), "studentCode": None, "answers": {},
                        "confidence": 0.0,
                        "warnings": [f"OMR processing error: {str(e)}"]}), 500
    finally:
        for path in (temp_path, out_path):
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except OSError:
                pass
        try:
            os.rmdir(temp_dir)
        except OSError:
            pass


if __name__ == "__main__":
    print(f"[OMR Service] Starting on port {PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=os.environ.get("OMR_DEBUG", "0") == "1")
