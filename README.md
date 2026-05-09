# VMRI Desk

VMRI Desk is an AI-assisted brain MRI screening workspace built for clinical-style review. It combines MRI upload, doctor login, structured reporting, saved case history, side-by-side case comparison, doctor impressions, printable export, and a report-aware assistant inside one application.

The project is designed to feel like a compact neuroimaging command center rather than a basic ML demo. A doctor can log in, upload a `.nii` or `.nii.gz` scan, review a structured report, save their own impression, reopen earlier cases, compare two studies, and use an assistant to summarize or explain report context.

## Why This Project Stands Out

- End-to-end workflow instead of a standalone model script
- Real medical imaging input with NIfTI MRI support
- Hybrid prediction pipeline using reference similarity, an ensemble classifier, and optional GNN inference
- Structured report generation tailored to doctor review
- Case archive, report status workflow, comparison mode, and doctor impression capture
- Backend-driven clinical assistant with report-aware answers
- Model validation surfaced in the product, not hidden in notebooks

## Core Features

- Doctor and hospital registration/login
- Patient intake before scan submission
- MRI upload for `.nii` and `.nii.gz`
- AI-assisted classification into:
  - Healthy
  - Alzheimer
  - Parkinson
- Differential probability display
- Scan preview from a representative MRI slice
- Key observations and recommendations
- Doctor impression editing and saved report status
- Filterable report history
- Side-by-side patient comparison
- Export to print/PDF and JSON
- Workspace analytics and validation summary
- Context-aware clinical assistant endpoint

## Project Architecture

### Frontend

Path: [`frontend/brain`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\frontend\brain)

The frontend is a React-based clinical workspace with:

- login/register flow
- patient intake form
- upload panel
- structured report view
- report archive and filters
- comparison view
- settings/operations summary
- assistant drawer

Main file:

- [`frontend/brain/src/App.js`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\frontend\brain\src\App.js)

### Backend

Path: [`backend`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend)

Main backend files:

- [`backend/app.py`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend\app.py): Flask API, auth routes, prediction route, report routes, assistant route, metrics route
- [`backend/vg.py`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend\vg.py): MRI preprocessing, feature extraction, ensemble inference, validation metrics, preview generation
- [`backend/auth_db.py`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend\auth_db.py): SQLite auth and report storage
- [`backend/assistant_engine.py`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend\assistant_engine.py): report-aware assistant logic
- [`backend/train_model.py`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend\train_model.py): rebuilds reference and classifier bundles

## Prediction Pipeline

### 1. MRI Input

The backend accepts `.nii` and `.nii.gz` files and loads them with `nibabel`.

### 2. Preprocessing

Each MRI is:

- loaded as a 3D volume
- resized to `16 x 16 x 16`
- normalized with z-score scaling

Formula:

`x' = (x - mean) / (std + 1e-5)`

### 3. Feature Extraction

The volume is converted into a 49-feature vector:

- 16 means across one axis
- 16 means across the second axis
- 16 means across the third axis
- 1 global standard deviation

### 4. Hybrid Inference

The prediction system combines three sources:

- reference similarity against stored MRI feature vectors
- an `ExtraTreesClassifier` ensemble
- an optional GNN path if the saved GNN bundle loads cleanly

Final probabilities are blended into a single output distribution.

### 5. Safety Heuristic

If the healthy class barely wins against a disease class, the pipeline slightly favors the disease class to reduce false reassurance in near-tie cases.

## Model Validation

The project now exposes model validation metrics directly from the backend.

Available metrics include:

- mean cross-validation accuracy
- fold-by-fold cross-validation accuracy
- confusion matrix
- per-class classification report
- feature importance ranking
- sample count
- GNN availability flag

Endpoint:

- `GET /model/metrics`

This makes the model story much stronger for demos, viva, and technical review because the app can now explain how the classifier was evaluated.

## Assistant Design

The assistant is backend-driven and report-aware.

Endpoint:

- `POST /assistant`

It answers narrow, practical workflow questions such as:

- summarize this case for handoff
- explain the confidence level
- what should I review next
- compare my selected reports
- show model validation metrics

The assistant is intentionally constrained to the report context and validation data so it behaves more like a clinical workflow helper than a free-form hallucinating chatbot.

## Database

The backend uses SQLite:

- [`backend/vmri.db`](C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend\vmri.db)

Stored data includes:

- hospital/doctor accounts
- saved analysis reports
- patient metadata
- doctor impressions
- workflow status
- model insights

## API Summary

- `GET /`
- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /predict`
- `GET /reports`
- `PATCH /reports/<report_id>`
- `GET /model/metrics`
- `POST /assistant`

## Local Run

### Backend

```powershell
cd C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend
python app.py
```

Backend runs at:

- [http://127.0.0.1:5000](http://127.0.0.1:5000)

### Frontend

```powershell
cd C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\frontend\brain
npm install
npm start
```

Frontend runs at:

- [http://localhost:3000](http://localhost:3000)

## Rebuild Model Bundles

If you retrain or refresh the reference data:

```powershell
cd C:\Users\srivi\OneDrive\Pictures\Desktop\vmri\backend
python train_model.py
```

This rebuilds:

- `reference_bundle.joblib`
- `classifier_bundle.joblib`

## Suggested Demo Flow

1. Log in as a doctor
2. Fill patient intake fields
3. Upload a `.nii` MRI scan
4. Run analysis
5. Review differential probabilities and scan preview
6. Add doctor impression and set report status
7. Open report history
8. Compare two saved reports
9. Ask the assistant for a handoff summary and confidence explanation
10. Open workspace summary to show validation metrics

## Resume / Portfolio Version

**VMRI Desk | AI-Assisted Brain MRI Screening Workspace**

Built a full-stack clinical-style MRI screening platform using React, Flask, SQLite, and machine learning for neurodegenerative disease triage. Designed an end-to-end workflow for doctor login, patient intake, NIfTI MRI upload, ensemble-based prediction, structured reporting, saved report archive, side-by-side case comparison, and a backend-driven report-aware assistant. Improved trust and explainability by surfacing model validation metrics, confidence bands, scan preview generation, and workflow-aware review states.

## Viva / Presentation Explanation

This project solves a workflow problem, not just a classification problem. Instead of building only a model that predicts a disease label, it builds a doctor-facing system around the model. The user can log in, upload an MRI, receive a structured report, save a final doctor impression, reopen previous studies, compare cases, and use a contextual assistant to support handoff and review. The model itself is hybrid: it combines handcrafted MRI features, reference similarity, and an ensemble classifier, while also preserving an optional GNN path. To make the system more credible, validation metrics are surfaced in the product itself.

## Current Limitations

- The current GNN uses a simplified graph structure and is not the main strength of the model
- The MRI representation is compact and may lose anatomical detail due to aggressive resizing
- SQLite is fine for demo use but should be replaced with Postgres for production
- The assistant is context-aware and backend-driven, but still rule-based rather than LLM-powered
- This is a screening support tool, not a diagnostic system

## Best Next Improvements

- replace SQLite with Postgres
- move the assistant to an LLM endpoint with guardrails
- train on a larger and more balanced dataset
- add stronger calibration and uncertainty estimation
- use a richer imaging model such as a 3D CNN or a real region-based brain graph
- add PDF export templates and admin-level validation dashboards

## License / Usage Note

This project is intended for academic demonstration, prototyping, and workflow exploration. It should not be used as a standalone clinical diagnosis system without proper validation, approvals, and specialist oversight.
