import hashlib
import hmac
import json
import os
import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "vmri.db"


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def hash_password(password):
    salt = os.urandom(16)
    derived_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return f"{salt.hex()}:{derived_key.hex()}"


def verify_password(password, stored_hash):
    salt_hex, derived_hex = stored_hash.split(":")
    salt = bytes.fromhex(salt_hex)
    expected = bytes.fromhex(derived_hex)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return hmac.compare_digest(actual, expected)


def init_db():
    connection = get_connection()
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS hospital_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doctor_name TEXT NOT NULL,
                hospital_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS analysis_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                patient_id TEXT,
                patient_name TEXT,
                patient_age TEXT,
                patient_sex TEXT,
                scan_date TEXT,
                clinical_notes TEXT,
                uploaded_file TEXT NOT NULL,
                prediction TEXT NOT NULL,
                primary_finding TEXT NOT NULL,
                confidence REAL NOT NULL,
                confidence_percent INTEGER NOT NULL,
                risk_level TEXT NOT NULL,
                analysis_status TEXT NOT NULL,
                triage_note TEXT NOT NULL,
                probabilities_json TEXT NOT NULL,
                scan_summary_json TEXT NOT NULL,
                recommendations_json TEXT NOT NULL,
                findings_json TEXT NOT NULL,
                model_insights_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES hospital_users(id)
            )
            """
        )
        ensure_columns(
            connection,
            "analysis_reports",
            {
                "primary_finding": "TEXT NOT NULL DEFAULT ''",
                "analysis_status": "TEXT NOT NULL DEFAULT 'Completed'",
                "triage_note": "TEXT NOT NULL DEFAULT ''",
                "model_insights_json": "TEXT NOT NULL DEFAULT '{}'",
                "doctor_impression": "TEXT NOT NULL DEFAULT ''",
                "comparison_note": "TEXT NOT NULL DEFAULT ''",
            },
        )
        connection.commit()
    finally:
        connection.close()


def register_hospital_user(doctor_name, hospital_name, email, password):
    connection = get_connection()
    try:
        existing_user = connection.execute(
            "SELECT id FROM hospital_users WHERE email = ?",
            (email,),
        ).fetchone()

        if existing_user is not None:
            return None

        connection.execute(
            """
            INSERT INTO hospital_users (doctor_name, hospital_name, email, password_hash)
            VALUES (?, ?, ?, ?)
            """,
            (doctor_name, hospital_name, email, hash_password(password)),
        )
        connection.commit()

        return find_user_by_email(email)
    finally:
        connection.close()


def find_user_by_email(email):
    connection = get_connection()
    try:
        row = connection.execute(
            """
            SELECT id, doctor_name, hospital_name, email, created_at
            FROM hospital_users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()

        if row is None:
            return None

        return {
            "id": row["id"],
            "doctorName": row["doctor_name"],
            "hospitalName": row["hospital_name"],
            "email": row["email"],
            "createdAt": row["created_at"],
        }
    finally:
        connection.close()


def authenticate_user(email, password):
    connection = get_connection()
    try:
        row = connection.execute(
            """
            SELECT id, doctor_name, hospital_name, email, password_hash, created_at
            FROM hospital_users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()

        if row is None:
            return None

        if not verify_password(password, row["password_hash"]):
            return None

        return {
            "id": row["id"],
            "doctorName": row["doctor_name"],
            "hospitalName": row["hospital_name"],
            "email": row["email"],
            "createdAt": row["created_at"],
        }
    finally:
        connection.close()


def save_analysis_report(user_id, report):
    connection = get_connection()
    try:
        connection.execute(
            """
            INSERT INTO analysis_reports (
                user_id,
                patient_id,
                patient_name,
                patient_age,
                patient_sex,
                scan_date,
                clinical_notes,
                uploaded_file,
                prediction,
                primary_finding,
                confidence,
                confidence_percent,
                risk_level,
                analysis_status,
                triage_note,
                doctor_impression,
                comparison_note,
                probabilities_json,
                scan_summary_json,
                recommendations_json,
                findings_json,
                model_insights_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                report["patient"].get("patientId", ""),
                report["patient"].get("patientName", ""),
                report["patient"].get("age", ""),
                report["patient"].get("sex", ""),
                report["patient"].get("scanDate", ""),
                report["patient"].get("clinicalNotes", ""),
                report["uploadedFile"],
                report["prediction"],
                report["primaryFinding"],
                report["confidence"],
                report["confidencePercent"],
                report["riskLevel"],
                report["analysisStatus"],
                report["triageNote"],
                report.get("doctorImpression", ""),
                report.get("comparisonNote", ""),
                json.dumps(report["probabilities"]),
                json.dumps(report["scanSummary"]),
                json.dumps(report["recommendations"]),
                json.dumps(report["keyObservations"]),
                json.dumps(report["modelInsights"]),
            ),
        )
        connection.commit()
        report_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
        return get_analysis_report(report_id)
    finally:
        connection.close()


def get_analysis_report(report_id):
    connection = get_connection()
    try:
        row = connection.execute(
            """
            SELECT *
            FROM analysis_reports
            WHERE id = ?
            """,
            (report_id,),
        ).fetchone()
        return None if row is None else _row_to_report(row)
    finally:
        connection.close()


def list_analysis_reports_for_user(user_id, limit=12, filters=None):
    connection = get_connection()
    try:
        query = [
            """
            SELECT *
            FROM analysis_reports
            WHERE user_id = ?
            """
        ]
        params = [user_id]
        filters = filters or {}

        if filters.get("patientId"):
            query.append("AND patient_id LIKE ?")
            params.append(f"%{filters['patientId']}%")
        if filters.get("prediction"):
            query.append("AND prediction = ?")
            params.append(filters["prediction"])
        if filters.get("riskLevel"):
            query.append("AND risk_level = ?")
            params.append(filters["riskLevel"])
        if filters.get("status"):
            query.append("AND analysis_status = ?")
            params.append(filters["status"])
        if filters.get("dateFrom"):
            query.append("AND date(created_at) >= date(?)")
            params.append(filters["dateFrom"])
        if filters.get("dateTo"):
            query.append("AND date(created_at) <= date(?)")
            params.append(filters["dateTo"])

        query.append("ORDER BY created_at DESC, id DESC LIMIT ?")
        params.append(limit)
        rows = connection.execute("\n".join(query), tuple(params)).fetchall()
        return [_row_to_report(row) for row in rows]
    finally:
        connection.close()


def update_analysis_report(report_id, user_id, analysis_status=None, doctor_impression=None):
    connection = get_connection()
    try:
        updates = []
        params = []

        if analysis_status is not None:
            updates.append("analysis_status = ?")
            params.append(analysis_status)
        if doctor_impression is not None:
            updates.append("doctor_impression = ?")
            params.append(doctor_impression)

        if not updates:
            return get_analysis_report(report_id)

        params.extend([report_id, user_id])
        connection.execute(
            f"""
            UPDATE analysis_reports
            SET {", ".join(updates)}
            WHERE id = ? AND user_id = ?
            """,
            tuple(params),
        )
        connection.commit()
        return get_analysis_report(report_id)
    finally:
        connection.close()


def _row_to_report(row):
    confidence_percent = int(row["confidence_percent"] or 0)
    analysis_status = row["analysis_status"] or "Draft"
    if analysis_status == "Needs Follow-up":
        confidence_band = "Review Required"
    elif confidence_percent >= 87:
        confidence_band = "High Confidence"
    elif confidence_percent >= 72:
        confidence_band = "Borderline"
    else:
        confidence_band = "Review Required"

    return {
        "id": row["id"],
        "patient": {
            "patientId": row["patient_id"] or "",
            "patientName": row["patient_name"] or "",
            "age": row["patient_age"] or "",
            "sex": row["patient_sex"] or "",
            "scanDate": row["scan_date"] or "",
            "clinicalNotes": row["clinical_notes"] or "",
        },
        "uploadedFile": row["uploaded_file"],
        "prediction": row["prediction"],
        "primaryFinding": row["primary_finding"] or f"{row['prediction']} pattern",
        "confidence": row["confidence"],
        "confidencePercent": confidence_percent,
        "confidenceBand": confidence_band,
        "riskLevel": row["risk_level"],
        "analysisStatus": analysis_status,
        "triageNote": row["triage_note"],
        "doctorImpression": row["doctor_impression"] or "",
        "comparisonNote": row["comparison_note"] or "",
        "probabilities": json.loads(row["probabilities_json"]),
        "scanSummary": json.loads(row["scan_summary_json"]),
        "recommendations": json.loads(row["recommendations_json"]),
        "keyObservations": json.loads(row["findings_json"]),
        "modelInsights": json.loads(row["model_insights_json"]),
        "createdAt": row["created_at"],
    }


def ensure_columns(connection, table_name, columns):
    existing_columns = {
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }

    for column_name, column_definition in columns.items():
        if column_name not in existing_columns:
            connection.execute(
                f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"
            )
