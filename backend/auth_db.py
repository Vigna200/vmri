import hashlib
import hmac
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
