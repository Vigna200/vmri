import os
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

from assistant_engine import answer_assistant_question
from auth_db import (
    authenticate_user,
    init_db,
    list_analysis_reports_for_user,
    register_hospital_user,
    save_analysis_report,
    update_analysis_report,
)
from vg import get_model_metrics, predict_new


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
SEX_OPTIONS = {"male", "female", "other", "unknown"}
REPORT_STATUS_OPTIONS = {"Draft", "Reviewed", "Needs Follow-up", "Closed"}

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
    if len(password) < 8 or not any(char.isalpha() for char in password) or not any(char.isdigit() for char in password):
        return jsonify({"error": "Password must be at least 8 characters and include letters and numbers."}), 400

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
    patient_payload = {
        "patientId": str(request.form.get("patientId", "")).strip(),
        "patientName": str(request.form.get("patientName", "")).strip(),
        "age": str(request.form.get("age", "")).strip(),
        "sex": str(request.form.get("sex", "Unknown")).strip().title() or "Unknown",
        "scanDate": str(request.form.get("scanDate", "")).strip(),
        "clinicalNotes": str(request.form.get("clinicalNotes", "")).strip(),
    }
    user_id = str(request.form.get("userId", "")).strip()

    if not file or not file.filename:
        return jsonify({"error": "Please choose an MRI scan in .nii or .nii.gz format"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Unsupported file type. Use .nii or .nii.gz"}), 400

    if not user_id.isdigit():
        return jsonify({"error": "A valid doctor session is required before analysis."}), 400

    if patient_payload["sex"].lower() not in SEX_OPTIONS:
        return jsonify({"error": "Patient sex must be Male, Female, Other, or Unknown."}), 400

    filename = secure_filename(file.filename)
    filepath = UPLOAD_FOLDER / filename
    file.save(filepath)

    try:
        prediction_index, probabilities, scan_summary, model_details = predict_new(filepath)
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
    review_flag = confidence < 0.78 or not scan_summary["referenceAgreement"]
    confidence_band = get_confidence_band(confidence, review_flag)
    report_payload = {
        "patient": patient_payload,
        "uploadedFile": filename,
        "prediction": prediction_label,
        "primaryFinding": f"{prediction_label} pattern",
        "confidence": round(confidence, 2),
        "confidencePercent": round(confidence * 100),
        "riskLevel": risk_level,
        "probabilities": probability_rows,
        "keyObservations": scan_summary["observations"][:4],
        "recommendations": RECOMMENDATION_MAP[prediction_label],
        "scanSummary": scan_summary,
        "confidenceBand": confidence_band,
        "triageNote": (
            "Escalate to specialist review before relying on this screening result."
            if review_flag
            else "Model agreement is stable enough for routine clinical review."
        ),
        "analysisStatus": "Needs Follow-up" if review_flag else "Draft",
        "doctorImpression": "",
        "comparisonNote": "",
        "modelInsights": model_details,
    }
    stored_report = save_analysis_report(int(user_id), report_payload)

    return jsonify(
        {
            **report_payload,
            "reportId": stored_report["id"],
            "createdAt": stored_report["createdAt"],
        }
    )


@app.get("/reports")
def reports():
    user_id = request.args.get("userId", "").strip()
    limit = request.args.get("limit", "").strip()
    if not user_id.isdigit():
        return jsonify({"error": "A valid userId query parameter is required."}), 400

    report_limit = int(limit) if limit.isdigit() else 12
    filters = {
        "patientId": request.args.get("patientId", "").strip(),
        "prediction": request.args.get("prediction", "").strip(),
        "riskLevel": request.args.get("riskLevel", "").strip(),
        "status": request.args.get("status", "").strip(),
        "dateFrom": request.args.get("dateFrom", "").strip(),
        "dateTo": request.args.get("dateTo", "").strip(),
    }
    reports_for_user = list_analysis_reports_for_user(int(user_id), report_limit, filters)
    return jsonify({"reports": reports_for_user})


@app.get("/model/metrics")
def model_metrics():
    return jsonify({"metrics": get_model_metrics()})


@app.patch("/reports/<int:report_id>")
def update_report(report_id):
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("userId", "")).strip()
    analysis_status = str(payload.get("analysisStatus", "")).strip()
    doctor_impression = str(payload.get("doctorImpression", "")).strip()

    if not user_id.isdigit():
        return jsonify({"error": "A valid doctor session is required before updating a report."}), 400

    if analysis_status and analysis_status not in REPORT_STATUS_OPTIONS:
        return jsonify({"error": "Report status must be Draft, Reviewed, Needs Follow-up, or Closed."}), 400

    updated_report = update_analysis_report(
        report_id,
        int(user_id),
        analysis_status=analysis_status or None,
        doctor_impression=doctor_impression,
    )

    if updated_report is None:
        return jsonify({"error": "Report not found."}), 404

    return jsonify({"report": updated_report})


@app.post("/assistant")
def assistant():
    payload = request.get_json(silent=True) or {}
    question = str(payload.get("question", "")).strip()
    active_report = payload.get("activeReport")
    comparison_reports = payload.get("comparisonReports") or []

    if not question:
        return jsonify({"error": "Question is required."}), 400

    answer = answer_assistant_question(
        question=question,
        active_report=active_report if isinstance(active_report, dict) else None,
        comparison_reports=[report for report in comparison_reports if isinstance(report, dict)],
        model_metrics=get_model_metrics(),
    )
    return jsonify(answer)


def np_max(values):
    return max(float(value) for value in values)


def get_risk_level(confidence):
    if confidence >= 0.85:
        return "High"
    if confidence >= 0.65:
        return "Moderate"
    return "Low"


def get_confidence_band(confidence, review_flag):
    if review_flag:
        return "Review Required"
    if confidence >= 0.87:
        return "High Confidence"
    if confidence >= 0.72:
        return "Borderline"
    return "Review Required"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
