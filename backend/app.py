import os
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

from auth_db import authenticate_user, init_db, register_hospital_user
from vg import predict_new


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_FOLDER = BASE_DIR / "uploads"
ALLOWED_EXTENSIONS = (".nii", ".nii.gz")
LABEL_MAP = {
    0: "Healthy",
    1: "Alzheimer",
    2: "Parkinson",
}
RECOMMENDATION_MAP = {
    "Healthy": [
        "Routine clinical follow-up if symptoms continue.",
        "Correlate with standard neurological evaluation.",
    ],
    "Alzheimer": [
        "Cognitive testing",
        "Neurology consult",
    ],
    "Parkinson": [
        "Movement-disorder evaluation",
        "Neurology consult",
    ],
}

UPLOAD_FOLDER.mkdir(exist_ok=True)
init_db()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024
CORS(app, resources={r"/*": {"origins": "*"}})


def allowed_file(filename):
    lowercase_name = filename.lower()
    return any(lowercase_name.endswith(ext) for ext in ALLOWED_EXTENSIONS)


@app.get("/")
def home():
    return jsonify(
        {
            "message": "VMRI backend is running",
            "status": "ok",
            "endpoints": {
                "health": "/health",
                "predict": "/predict",
                "register": "/auth/register",
                "login": "/auth/login",
            },
        }
    )


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/auth/register")
def register():
    payload = request.get_json(silent=True) or {}
    doctor_name = str(payload.get("doctorName", "")).strip()
    hospital_name = str(payload.get("hospitalName", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", "")).strip()

    if not doctor_name or not hospital_name or not email or not password:
        return jsonify({"error": "Doctor name, hospital name, email, and password are required."}), 400

    user = register_hospital_user(doctor_name, hospital_name, email, password)
    if user is None:
        return jsonify({"error": "This hospital account already exists. Please log in instead."}), 409

    return jsonify({"message": "Registration complete.", "user": user}), 201


@app.post("/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", "")).strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    user = authenticate_user(email, password)
    if user is None:
        return jsonify({"error": "Invalid login. Check the entered email and password."}), 401

    return jsonify({"message": "Login successful.", "user": user})


@app.post("/predict")
def predict():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]

    if not file or not file.filename:
        return jsonify({"error": "Please choose an MRI scan in .nii or .nii.gz format"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Unsupported file type. Use .nii or .nii.gz"}), 400

    filename = secure_filename(file.filename)
    filepath = UPLOAD_FOLDER / filename
    file.save(filepath)

    try:
        prediction_index, probabilities, scan_summary = predict_new(filepath)
    except Exception as exc:
        return jsonify({"error": f"Prediction failed: {exc}"}), 500
    finally:
        if filepath.exists():
            os.remove(filepath)

    confidence = float(np_max(probabilities))
    prediction_label = LABEL_MAP[prediction_index]
    risk_level = get_risk_level(confidence)
    probability_rows = [
        {
            "label": "Healthy",
            "value": float(probabilities[0]),
            "percent": round(float(probabilities[0]) * 100),
        },
        {
            "label": "Alzheimer",
            "value": float(probabilities[1]),
            "percent": round(float(probabilities[1]) * 100),
        },
        {
            "label": "Parkinson",
            "value": float(probabilities[2]),
            "percent": round(float(probabilities[2]) * 100),
        },
    ]

    return jsonify(
        {
            "uploadedFile": filename,
            "prediction": prediction_label,
            "primaryFinding": f"{prediction_label} pattern",
            "confidence": round(confidence, 2),
            "confidencePercent": round(confidence * 100),
            "riskLevel": risk_level,
            "probabilities": probability_rows,
            "keyObservations": scan_summary["observations"][:3],
            "recommendations": RECOMMENDATION_MAP[prediction_label],
            "scanSummary": scan_summary,
        }
    )


def np_max(values):
    return max(float(value) for value in values)


def get_risk_level(confidence):
    if confidence >= 0.85:
        return "High"
    if confidence >= 0.65:
        return "Moderate"
    return "Low"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
