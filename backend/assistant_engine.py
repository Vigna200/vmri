from __future__ import annotations

from typing import Any


def _safe_percent(value: Any) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0


def _patient_label(report: dict[str, Any] | None) -> str:
    if not report:
        return "this case"
    patient = report.get("patient") or {}
    return patient.get("patientName") or patient.get("patientId") or "this case"


def _report_summary(report: dict[str, Any]) -> str:
    return (
        f"{_patient_label(report)} is screened as {report.get('prediction', 'Unknown')} "
        f"with {_safe_percent(report.get('confidencePercent'))}% confidence. "
        f"Primary finding: {report.get('primaryFinding') or report.get('prediction', 'Unknown')} pattern. "
        f"Current status: {report.get('analysisStatus') or 'Draft'}."
    )


def _observations_text(report: dict[str, Any]) -> str:
    observations = report.get("keyObservations") or []
    if not observations:
        return "No structured observations are stored for this case yet."
    return " ".join(observations[:4])


def _recommendations_text(report: dict[str, Any]) -> str:
    recommendations = report.get("recommendations") or []
    if not recommendations:
        return "No follow-up recommendations are stored for this case yet."
    return " ".join(recommendations[:4])


def _compare_reports(report_a: dict[str, Any] | None, report_b: dict[str, Any] | None) -> str:
    if not report_a or not report_b:
        return "Select two saved reports to compare confidence, workflow status, observations, and follow-up guidance side by side."

    confidence_a = _safe_percent(report_a.get("confidencePercent"))
    confidence_b = _safe_percent(report_b.get("confidencePercent"))
    stronger = report_a if confidence_a >= confidence_b else report_b
    other = report_b if stronger is report_a else report_a

    return (
        f"{_patient_label(stronger)} carries the stronger screening signal at "
        f"{_safe_percent(stronger.get('confidencePercent'))}% confidence for {stronger.get('prediction')}. "
        f"{_patient_label(other)} is at {_safe_percent(other.get('confidencePercent'))}% confidence for "
        f"{other.get('prediction')}. Compare workflow status "
        f"({stronger.get('analysisStatus') or 'Draft'} vs {other.get('analysisStatus') or 'Draft'}) "
        f"and confirm whether the recommendations or doctor impressions diverge."
    )


def _next_steps(report: dict[str, Any]) -> str:
    tips: list[str] = []
    confidence_band = report.get("confidenceBand") or "Review Required"
    if confidence_band == "Review Required":
        tips.append("Treat this output as a screening flag and keep it in specialist review before final handoff.")
    elif confidence_band == "Borderline":
        tips.append("The confidence is borderline, so correlate this result with clinical findings and any prior studies.")
    else:
        tips.append("Confidence is relatively stable, but the result still needs routine clinical confirmation.")

    if report.get("analysisStatus") == "Needs Follow-up":
        tips.append("Keep the case open, document a doctor impression, and confirm whether escalation is needed.")

    if report.get("prediction") == "Alzheimer":
        tips.append("Pair this with cognitive testing, caregiver history, and prior memory workup.")
    elif report.get("prediction") == "Parkinson":
        tips.append("Pair this with motor symptom history and a movement-disorder examination.")
    else:
        tips.append("If symptoms remain despite a healthy screen, schedule correlation and follow-up review.")

    tips.append("Verify patient identifiers, scan date, and report status before export or print.")
    return " ".join(tips)


def answer_assistant_question(
    question: str,
    active_report: dict[str, Any] | None = None,
    comparison_reports: list[dict[str, Any]] | None = None,
    model_metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    trimmed = (question or "").strip()
    comparison_reports = comparison_reports or []
    text = trimmed.lower()
    words = set(part for part in text.replace("/", " ").replace("-", " ").split() if part)

    if not trimmed:
        return {
            "answer": "Ask for a case summary, confidence explanation, next-step review guidance, model metrics, or a comparison summary.",
            "intent": "empty",
        }

    if "compare" in text:
        return {
            "answer": _compare_reports(
                comparison_reports[0] if len(comparison_reports) > 0 else None,
                comparison_reports[1] if len(comparison_reports) > 1 else None,
            ),
            "intent": "compare",
        }

    if active_report is None:
        if "model" in text or "accuracy" in text or "metric" in text:
            if not model_metrics:
                return {
                    "answer": "Model metrics are not available yet. Rebuild the classifier bundle or open the workspace summary after the backend loads fully.",
                    "intent": "metrics",
                }
            return {
                "answer": (
                    f"The current ensemble reports {model_metrics.get('cvMeanAccuracyPercent', 0)}% mean cross-validation accuracy "
                    f"across {model_metrics.get('sampleCount', 0)} reference studies."
                ),
                "intent": "metrics",
            }

        return {
            "answer": "Open a saved report or run a new study first. Then I can summarize the case, explain confidence, compare reports, or suggest follow-up steps.",
            "intent": "no-context",
        }

    if "confidence" in text:
        return {
            "answer": (
                f"{active_report.get('confidenceBand') or 'Review Required'} at "
                f"{_safe_percent(active_report.get('confidencePercent'))}% confidence. "
                f"Risk level is {active_report.get('riskLevel')}, and current workflow status is "
                f"{active_report.get('analysisStatus') or 'Draft'}."
            ),
            "intent": "confidence",
        }

    if "model" in text or "accuracy" in text or "metric" in text or "validation" in text:
        if not model_metrics:
            return {
                "answer": "Model validation metrics are not loaded right now. Check the workspace summary after the backend metrics endpoint is available.",
                "intent": "metrics",
            }

        fold_scores = model_metrics.get("cvFoldAccuraciesPercent") or []
        fold_text = ", ".join(f"{score}%" for score in fold_scores[:5]) if fold_scores else "not available"
        return {
            "answer": (
                f"The current ensemble reports {model_metrics.get('cvMeanAccuracyPercent', 0)}% mean cross-validation accuracy "
                f"across {model_metrics.get('sampleCount', 0)} reference studies. Fold accuracies: {fold_text}. "
                f"Top contributing features include {', '.join(model_metrics.get('topFeatureNames', [])[:3]) or 'the learned slice-summary features'}."
            ),
            "intent": "metrics",
        }

    if "review" in text or "next" in text or "follow" in text:
        return {"answer": _next_steps(active_report), "intent": "next-steps"}

    if "observation" in words or "observations" in words or "finding" in words or "findings" in words:
        return {"answer": _observations_text(active_report), "intent": "observations"}

    if "recommendation" in words or "recommendations" in words:
        return {"answer": _recommendations_text(active_report), "intent": "recommendations"}

    if "status" in words or "workflow" in words:
        return {
            "answer": (
                f"The report is currently marked as {active_report.get('analysisStatus') or 'Draft'}. "
                f"Triage note: {active_report.get('triageNote') or 'Routine clinical review recommended.'}"
            ),
            "intent": "status",
        }

    if "note" in words or "notes" in words or "impression" in words:
        doctor_impression = active_report.get("doctorImpression")
        if doctor_impression:
            return {"answer": f"Saved doctor impression: {doctor_impression}", "intent": "impression"}
        return {
            "answer": (
                "No doctor impression is saved yet. Add one in the review section so the final handoff includes your own clinical conclusion."
            ),
            "intent": "impression",
        }

    if "summary" in text or "handoff" in text:
        return {"answer": _report_summary(active_report), "intent": "summary"}

    return {
        "answer": (
            f"{_report_summary(active_report)} Key observations: {_observations_text(active_report)} "
            f"Recommended next step: {_next_steps(active_report)}"
        ),
        "intent": "general",
    }
