import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./styles.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:5000";
const SESSION_STORAGE_KEY = "vmri_session";
const ACTIVITY_STORAGE_KEY = "vmri_last_activity";
const HISTORY_LIMIT = 50;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const ANALYSIS_STAGES = [
  "Validating study package",
  "Preprocessing volumetric scan",
  "Running ensemble screening",
  "Preparing structured report",
];
const QUICK_PROMPTS = [
  "Summarize this case for handoff",
  "What should I review next?",
  "Explain the confidence level",
  "Compare my selected reports",
  "Show model validation metrics",
];
const REPORT_STATUS_OPTIONS = ["Draft", "Reviewed", "Needs Follow-up", "Closed"];

const emptyForm = {
  doctorName: "",
  hospitalName: "",
  email: "",
  password: "",
};

const emptyPatientForm = {
  patientId: "",
  patientName: "",
  age: "",
  sex: "Unknown",
  scanDate: "",
  clinicalNotes: "",
};

const emptyFilters = {
  patientId: "",
  prediction: "",
  status: "",
  riskLevel: "",
  dateFrom: "",
  dateTo: "",
};

function readStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function touchActivity() {
  window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));
}

function readLastActivity() {
  const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
  return raw ? Number(raw) : Date.now();
}

function formatDate(value) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPatientLine(patient) {
  const pieces = [patient.patientName || "Unnamed case", patient.patientId || "No ID"];
  return pieces.join(" - ");
}

function buildAssistantTips(report) {
  if (!report) {
    return [
      "Complete patient identifiers and brief clinical notes before upload.",
      "Keep one MRI study per case so the archive remains easier to review.",
      "Use print preview before handoff to verify the final report layout.",
    ];
  }

  const tips = [];
  if ((report.confidencePercent || 0) < 80) {
    tips.push("Confidence is below the preferred review threshold, so use this result as a screening flag rather than a standalone conclusion.");
  }
  if (report.analysisStatus === "Needs Follow-up") {
    tips.push("This report is marked for additional review. Correlate with clinical findings and any prior studies before documenting an impression.");
  }
  if (report.prediction === "Alzheimer") {
    tips.push("Combine this output with cognitive testing, caregiver history, and prior memory workup when escalating the case.");
  } else if (report.prediction === "Parkinson") {
    tips.push("Pair this output with motor symptom history and specialist examination findings during follow-up.");
  } else if (report.prediction === "Healthy") {
    tips.push("A healthy screen does not exclude symptoms. If concern remains high, plan correlation and follow-up review.");
  }
  tips.push("Verify patient identifiers and scan date before printing or exporting the report.");
  return tips.slice(0, 4);
}

function buildChecklist(patientForm, file, report) {
  return [
    {
      label: "Patient identifiers completed",
      done: Boolean(patientForm.patientId.trim() && patientForm.patientName.trim()),
    },
    {
      label: "MRI study attached",
      done: Boolean(file),
    },
    {
      label: "Clinical context added",
      done: Boolean(patientForm.clinicalNotes.trim()),
    },
    {
      label: "Report reviewed for follow-up",
      done: Boolean(report),
    },
  ];
}

function summarizeComparison(reportA, reportB) {
  if (!reportA || !reportB) {
    return "Select two reports to compare confidence, status, and recommendations side by side.";
  }

  const stronger = (reportA.confidencePercent || 0) >= (reportB.confidencePercent || 0) ? reportA : reportB;
  return `${stronger.patient?.patientName || stronger.patient?.patientId || "One case"} has the stronger confidence signal at ${stronger.confidencePercent || 0}%, while the other report should be checked for differences in risk level, follow-up status, and recommendations.`;
}

function renderIconBadge(label) {
  return <span className="icon-badge">{label}</span>;
}

function buildPdfDocument(report) {
  const probabilities = (report.probabilities || [])
    .map((item) => `<li><strong>${item.label}:</strong> ${item.percent}%</li>`)
    .join("");
  const observations = (report.keyObservations || []).map((item) => `<li>${item}</li>`).join("");
  const recommendations = (report.recommendations || []).map((item) => `<li>${item}</li>`).join("");

  return `
    <html>
      <head>
        <title>VMRI Report</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 28px; color: #10253d; }
          h1, h2, h3 { margin: 0 0 12px; }
          h1 { font-size: 28px; }
          h2 { font-size: 18px; margin-top: 24px; }
          .meta, .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-top: 16px; }
          .tile, .box { border: 1px solid #d6e1ea; border-radius: 14px; padding: 14px; }
          .tile strong, .meta strong { display: block; margin-top: 6px; }
          ul { margin: 8px 0 0 18px; line-height: 1.6; }
          p { line-height: 1.6; }
        </style>
      </head>
      <body>
        <h1>VMRI Clinical Report</h1>
        <p><strong>Patient:</strong> ${report.patient?.patientName || "Unnamed case"} | <strong>Patient ID:</strong> ${report.patient?.patientId || "Not recorded"}</p>
        <div class="tiles">
          <div class="tile"><span>Primary finding</span><strong>${report.primaryFinding || report.prediction}</strong></div>
          <div class="tile"><span>Confidence</span><strong>${report.confidencePercent || 0}% (${report.confidenceBand || "Review Required"})</strong></div>
          <div class="tile"><span>Status</span><strong>${report.analysisStatus || "Draft"}</strong></div>
          <div class="tile"><span>Risk level</span><strong>${report.riskLevel}</strong></div>
        </div>
        <div class="meta">
          <div class="box"><strong>Age / Sex</strong>${report.patient?.age || "Not recorded"} / ${report.patient?.sex || "Unknown"}</div>
          <div class="box"><strong>Scan date</strong>${report.patient?.scanDate || "Not recorded"}</div>
          <div class="box"><strong>Uploaded study</strong>${report.uploadedFile || "Not recorded"}</div>
          <div class="box"><strong>Created</strong>${formatDate(report.createdAt)}</div>
        </div>
        <h2>Clinical Notes</h2>
        <p>${report.patient?.clinicalNotes || "No additional notes supplied."}</p>
        <h2>Differential Probabilities</h2>
        <ul>${probabilities}</ul>
        <h2>Key Observations</h2>
        <ul>${observations}</ul>
        <h2>Recommendations</h2>
        <ul>${recommendations}</ul>
        <h2>Doctor Impression</h2>
        <p>${report.doctorImpression || "No doctor impression saved yet."}</p>
      </body>
    </html>
  `;
}

function App() {
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(emptyForm);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeView, setActiveView] = useState("analysis");
  const [patientForm, setPatientForm] = useState(emptyPatientForm);
  const [filters, setFilters] = useState(emptyFilters);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [comparisonIds, setComparisonIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analysisStage, setAnalysisStage] = useState(0);
  const [error, setError] = useState("");
  const [saveMessages, setSaveMessages] = useState({});
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState([
    {
      role: "assistant",
      text: "Ask for a handoff summary, confidence explanation, follow-up guidance, or a comparison summary.",
    },
  ]);
  const [reportDrafts, setReportDrafts] = useState({});
  const [modelMetrics, setModelMetrics] = useState(null);

  useEffect(() => {
    const storedSession = readStoredSession();
    if (storedSession) {
      setCurrentUser(storedSession);
      touchActivity();
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      setAnalysisStage(0);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setAnalysisStage((current) => Math.min(current + 1, ANALYSIS_STAGES.length - 1));
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [loading]);

  const fetchHistory = useCallback(
    async (userId, nextFilters = filters) => {
      setHistoryLoading(true);

      try {
        const response = await axios.get(`${API_BASE_URL}/reports`, {
          params: {
            userId,
            limit: HISTORY_LIMIT,
            ...nextFilters,
          },
        });
        const nextHistory = response.data.reports || [];
        setHistory(nextHistory);
        if (!result && nextHistory.length > 0 && !selectedHistoryId) {
          setSelectedHistoryId(nextHistory[0].id);
        }
      } catch (requestError) {
        setError(requestError.response?.data?.error || "Report history could not be loaded right now.");
      } finally {
        setHistoryLoading(false);
      }
    },
    [filters, result, selectedHistoryId]
  );

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    fetchHistory(currentUser.id, filters);
  }, [currentUser, filters, fetchHistory]);

  useEffect(() => {
    if (!currentUser) {
      setModelMetrics(null);
      return;
    }

    let cancelled = false;

    async function fetchModelMetrics() {
      try {
        const response = await axios.get(`${API_BASE_URL}/model/metrics`);
        if (!cancelled) {
          setModelMetrics(response.data.metrics || null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setModelMetrics(null);
        }
      }
    }

    fetchModelMetrics();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      return undefined;
    }

    const updateActivity = () => touchActivity();
    const intervalId = window.setInterval(() => {
      if (Date.now() - readLastActivity() > SESSION_TIMEOUT_MS) {
        handleLogout(true);
      }
    }, 60000);

    window.addEventListener("click", updateActivity);
    window.addEventListener("keydown", updateActivity);
    window.addEventListener("mousemove", updateActivity);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("click", updateActivity);
      window.removeEventListener("keydown", updateActivity);
      window.removeEventListener("mousemove", updateActivity);
    };
    // handleLogout intentionally closes over the current session snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const fileSummary = useMemo(() => {
    if (!file) {
      return "No study selected";
    }

    return `${file.name} - ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  }, [file]);

  const activeReport = useMemo(() => {
    if (result) {
      return result;
    }
    if (selectedHistoryId) {
      return history.find((entry) => entry.id === selectedHistoryId) || null;
    }
    return history[0] || null;
  }, [history, result, selectedHistoryId]);

  const comparisonReports = useMemo(
    () => comparisonIds.map((id) => history.find((entry) => entry.id === id)).filter(Boolean),
    [comparisonIds, history]
  );

  useEffect(() => {
    if (!activeReport) {
      return;
    }

    const reportKey = String(activeReport.reportId || activeReport.id);
    setReportDrafts((current) => {
      if (current[reportKey]) {
        return current;
      }

      return {
        ...current,
        [reportKey]: {
          analysisStatus: activeReport.analysisStatus || "Draft",
          doctorImpression: activeReport.doctorImpression || "",
        },
      };
    });
  }, [activeReport]);

  const quickStats = useMemo(() => {
    const completed = history.length;
    const reviewNeeded = history.filter((entry) => entry.analysisStatus === "Needs Follow-up").length;
    const averageConfidence = history.length
      ? Math.round(history.reduce((sum, entry) => sum + (entry.confidencePercent || 0), 0) / history.length)
      : 0;
    const classCounts = history.reduce(
      (accumulator, entry) => ({
        ...accumulator,
        [entry.prediction]: (accumulator[entry.prediction] || 0) + 1,
      }),
      {}
    );

    return {
      completed,
      reviewNeeded,
      averageConfidence,
      classCounts,
      recentActivity: history.slice(0, 4),
    };
  }, [history]);

  const assistantTips = useMemo(() => buildAssistantTips(activeReport), [activeReport]);
  const caseChecklist = useMemo(() => buildChecklist(patientForm, file, activeReport), [patientForm, file, activeReport]);

  function updateAuthForm(field, value) {
    setAuthForm((current) => ({ ...current, [field]: value }));
    setAuthError("");
    setAuthMessage("");
  }

  function updatePatientForm(field, value) {
    setPatientForm((current) => ({ ...current, [field]: value }));
    setError("");
    setSaveMessages({});
  }

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    setFilters(emptyFilters);
  }

  function resetAuthForm() {
    setAuthForm(emptyForm);
  }

  function resetPatientWorkspace() {
    setPatientForm(emptyPatientForm);
    setFile(null);
    setLoading(false);
    setAnalysisStage(0);
    setError("");
  }

  async function handleRegister(event) {
    event.preventDefault();

    const normalizedEmail = authForm.email.trim().toLowerCase();
    const doctorName = authForm.doctorName.trim();
    const hospitalName = authForm.hospitalName.trim();
    const password = authForm.password.trim();

    if (!doctorName || !hospitalName || !normalizedEmail || !password) {
      setAuthError("Please complete doctor name, hospital name, email, and password.");
      return;
    }

    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");

    try {
      const response = await axios.post(`${API_BASE_URL}/auth/register`, {
        doctorName,
        hospitalName,
        email: normalizedEmail,
        password,
      });
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(response.data.user));
      touchActivity();
      setCurrentUser(response.data.user);
      setAuthMessage("Registration complete. Your clinical workspace is ready.");
      resetAuthForm();
    } catch (requestError) {
      setAuthError(
        requestError.response?.data?.error || "Registration failed. Please check the service connection and try again."
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();

    const normalizedEmail = authForm.email.trim().toLowerCase();
    const password = authForm.password.trim();

    if (!normalizedEmail || !password) {
      setAuthError("Please enter your registered email and password.");
      return;
    }

    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");

    try {
      const response = await axios.post(`${API_BASE_URL}/auth/login`, {
        email: normalizedEmail,
        password,
      });
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(response.data.user));
      touchActivity();
      setCurrentUser(response.data.user);
      resetAuthForm();
    } catch (requestError) {
      setAuthError(requestError.response?.data?.error || "Login failed. Please check the service connection and try again.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout(timeoutTriggered = false) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem(ACTIVITY_STORAGE_KEY);
    setCurrentUser(null);
    setResult(null);
    setHistory([]);
    setSelectedHistoryId(null);
    setComparisonIds([]);
    setAssistantMessages([
      {
        role: "assistant",
        text: timeoutTriggered
          ? "Session timed out for safety. Sign in again to continue."
          : "Ask for a handoff summary, confidence explanation, follow-up guidance, or a comparison summary.",
      },
    ]);
    setAssistantOpen(false);
    resetPatientWorkspace();
  }

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setResult(null);
    setError("");
  }

  async function handleUpload() {
    if (!file) {
      setError("Please choose an MRI file in .nii or .nii.gz format.");
      return;
    }

    if (!patientForm.patientId.trim() || !patientForm.patientName.trim()) {
      setError("Patient ID and patient name are required before analysis.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("userId", String(currentUser.id));
    Object.entries(patientForm).forEach(([field, value]) => formData.append(field, value));

    setLoading(true);
    setResult(null);
    setSelectedHistoryId(null);
    setError("");
    setSaveMessages({});

    try {
      const response = await axios.post(`${API_BASE_URL}/predict`, formData, {
        timeout: 180000,
      });
      setResult(response.data);
      setAssistantMessages([
        {
          role: "assistant",
          text: "New report loaded. Ask me for a handoff summary, confidence explanation, or next-step guidance.",
        },
      ]);
      await fetchHistory(currentUser.id, filters);
      setActiveView("analysis");
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          "Result could not be generated. Confirm the service is online and the uploaded MRI file is valid."
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleComparison(reportId) {
    setComparisonIds((current) => {
      if (current.includes(reportId)) {
        return current.filter((id) => id !== reportId);
      }
      if (current.length === 2) {
        return [current[1], reportId];
      }
      return [...current, reportId];
    });
  }

  function openComparisonView() {
    if (comparisonIds.length === 2) {
      setActiveView("compare");
    }
  }

  function handleSelectReport(report) {
    setResult(null);
    setSelectedHistoryId(report.id);
    setActiveView("history");
    setAssistantMessages([
      {
        role: "assistant",
        text: "Saved report opened. Ask for a handoff summary, confidence explanation, or suggested follow-up.",
      },
    ]);
  }

  function handlePrintReport() {
    window.print();
  }

  function handleExportPdf() {
    if (!activeReport) {
      return;
    }
    const previewWindow = window.open("", "_blank", "width=980,height=720");
    if (!previewWindow) {
      return;
    }
    previewWindow.document.open();
    previewWindow.document.write(buildPdfDocument(activeReport));
    previewWindow.document.close();
    previewWindow.focus();
    previewWindow.print();
  }

  function handleDownloadReport() {
    if (!activeReport) {
      return;
    }
    const blob = new Blob([JSON.stringify(activeReport, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vmri-report-${activeReport.reportId || activeReport.id || "case"}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  async function handleSaveReportReview(report = activeReport) {
    if (!report || !currentUser) {
      return;
    }
    const reportKey = String(report.reportId || report.id);
    const draft = reportDrafts[reportKey] || {
      analysisStatus: report.analysisStatus || "Draft",
      doctorImpression: report.doctorImpression || "",
    };
    setSaveMessages((current) => ({
      ...current,
      [reportKey]: "",
    }));
    setError("");
    try {
      const response = await axios.patch(`${API_BASE_URL}/reports/${report.reportId || report.id}`, {
        userId: currentUser.id,
        analysisStatus: draft.analysisStatus,
        doctorImpression: draft.doctorImpression,
      });
      const updated = response.data.report;
      setResult((current) => (current ? { ...current, ...updated, reportId: current.reportId || updated.id } : current));
      setHistory((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setReportDrafts((current) => ({
        ...current,
        [String(updated.reportId || updated.id || updated.id)]: {
          analysisStatus: updated.analysisStatus || "Draft",
          doctorImpression: updated.doctorImpression || "",
        },
      }));
      await fetchHistory(currentUser.id, filters);
      setSaveMessages((current) => ({
        ...current,
        [reportKey]: "Review details saved.",
      }));
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Report changes could not be saved.");
    }
  }

  async function sendAssistantMessage(message) {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    setAssistantMessages((current) => [
      ...current,
      { role: "user", text: trimmed },
    ]);
    setAssistantInput("");
    setAssistantOpen(true);
    setAssistantLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/assistant`, {
        question: trimmed,
        activeReport,
        comparisonReports,
      });
      setAssistantMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: response.data.answer || "I could not generate a useful reply for that question yet.",
        },
      ]);
    } catch (requestError) {
      setAssistantMessages((current) => [
        ...current,
        {
          role: "assistant",
          text:
            requestError.response?.data?.error ||
            "The assistant could not respond right now. Please try again after the backend is running.",
        },
      ]);
    } finally {
      setAssistantLoading(false);
    }
  }

  function renderAuthScreen() {
    return (
      <main className="auth-shell">
        <section className="auth-hero panel-surface">
          <div className="auth-badge">{renderIconBadge("Desk")} VMRI Clinical Screening Desk</div>
          <h1>Professional neuroimaging triage with a clearer hospital workflow.</h1>
          <p>
            Move from registration to patient intake, MRI upload, structured reporting, and report history in one workspace designed for clinical review.
          </p>

          <div className="hero-grid">
            <div className="hero-card">
              <span>Workstation</span>
              <strong>Patient intake, MRI review, printable report, and audit history.</strong>
            </div>
            <div className="hero-card">
              <span>Screening engine</span>
              <strong>Reference matching plus a trained ensemble for steadier classification.</strong>
            </div>
            <div className="hero-card">
              <span>Built for</span>
              <strong>Neurology clinics, radiology teams, and everyday doctor review.</strong>
            </div>
          </div>
        </section>

        <section className="auth-panel panel-surface">
          <div className="auth-tabs">
            <button className={authMode === "login" ? "tab-button active" : "tab-button"} onClick={() => { setAuthMode("login"); setAuthError(""); setAuthMessage(""); }}>
              Doctor Login
            </button>
            <button className={authMode === "register" ? "tab-button active" : "tab-button"} onClick={() => { setAuthMode("register"); setAuthError(""); setAuthMessage(""); }}>
              Hospital Register
            </button>
          </div>

          <div className="auth-copy">
            <h2>{authMode === "login" ? "Return to the command desk" : "Create a hospital workspace"}</h2>
            <p>
              {authMode === "login"
                ? "Sign in to review prior cases and run new AI-assisted MRI studies."
                : "Create the doctor and hospital identity that will own future reports."}
            </p>
          </div>

          <form className="auth-form" onSubmit={authMode === "login" ? handleLogin : handleRegister}>
            {authMode === "register" ? (
              <>
                <label className="field-group">
                  <span>Doctor Name</span>
                  <input type="text" value={authForm.doctorName} onChange={(event) => updateAuthForm("doctorName", event.target.value)} placeholder="Dr. A. Kumar" />
                </label>

                <label className="field-group">
                  <span>Hospital Name</span>
                  <input type="text" value={authForm.hospitalName} onChange={(event) => updateAuthForm("hospitalName", event.target.value)} placeholder="City Neuro Hospital" />
                </label>
              </>
            ) : null}

            <label className="field-group">
              <span>Email</span>
              <input type="email" value={authForm.email} onChange={(event) => updateAuthForm("email", event.target.value)} placeholder="doctor@hospital.com" />
            </label>

            <label className="field-group">
              <span>Password</span>
              <div className="password-row">
                <input
                  type={showPassword ? "text" : "password"}
                  value={authForm.password}
                  onChange={(event) => updateAuthForm("password", event.target.value)}
                  placeholder="Enter password"
                />
                <button className="ghost-button" type="button" onClick={() => setShowPassword((current) => !current)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <small className="helper-copy">Use at least 8 characters with letters and numbers.</small>
            </label>

            {authError ? <div className="message error-message">{authError}</div> : null}
            {authMessage ? <div className="message success-message">{authMessage}</div> : null}

            <button className="auth-submit" type="submit" disabled={authLoading}>
              {authLoading ? "Please wait..." : authMode === "login" ? "Enter Workspace" : "Register and Continue"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  function renderSidebar() {
    const items = [
      { id: "analysis", label: "New Analysis", mark: "A1" },
      { id: "history", label: "Report History", mark: "R2" },
      { id: "compare", label: "Compare", mark: "C3" },
      { id: "settings", label: "Workspace", mark: "W4" },
    ];

    return (
      <aside className="sidebar panel-surface">
        <div className="brand-block">
          <div className="brand-mark">VM</div>
          <div>
            <div className="workspace-badge">{renderIconBadge("Desk")} Clinical Workspace</div>
            <h2>VMRI Desk</h2>
          </div>
        </div>

        <nav className="sidebar-nav">
          {items.map((item) => (
            <button key={item.id} className={activeView === item.id ? "nav-button active" : "nav-button"} onClick={() => setActiveView(item.id)}>
              <span className="nav-mark">{item.mark}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <span>Doctor</span>
          <strong>{currentUser.doctorName}</strong>
          <p>{currentUser.hospitalName}</p>
        </div>

        <div className="sidebar-card">
          <span>Recent output</span>
          <strong>{quickStats.completed}</strong>
          <p>Saved studies ready for reopening, printing, and follow-up discussion.</p>
        </div>
      </aside>
    );
  }

  function renderMetrics() {
    return (
      <section className="metric-grid">
        <article className="metric-card panel-surface">
          <span>Completed reports</span>
          <strong>{quickStats.completed}</strong>
          <p>Recent studies available for review and handoff.</p>
        </article>
        <article className="metric-card panel-surface">
          <span>Review needed</span>
          <strong>{quickStats.reviewNeeded}</strong>
          <p>Cases flagged by lower confidence or model disagreement.</p>
        </article>
        <article className="metric-card panel-surface">
          <span>Average confidence</span>
          <strong>{quickStats.averageConfidence}%</strong>
          <p>Average confidence across the visible report archive.</p>
        </article>
      </section>
    );
  }

  function renderAnalysisPanel() {
    const stageLabel = loading ? ANALYSIS_STAGES[analysisStage] : "Awaiting study submission";

    return (
      <section className="workspace-column">
        <section className="header-strip panel-surface">
          <div>
            <div className="workspace-badge">{renderIconBadge("Desk")} Doctor Workspace</div>
            <h1 className="dashboard-title">VMRI Clinical Command Center</h1>
            <p className="dashboard-subtitle">{currentUser.doctorName} - {currentUser.hospitalName}</p>
          </div>

          <div className="header-actions">
            <div className="identity-card">
              <span>Signed in</span>
              <strong>{currentUser.email}</strong>
            </div>
            <button className="secondary-button" onClick={() => handleLogout(false)}>
              Logout
            </button>
          </div>
        </section>

        {renderMetrics()}

        <section className="workspace-grid">
          <article className="intake-panel panel-surface">
            <div className="section-heading">
              <div>
                <span className="report-kicker">{renderIconBadge("Case")} Patient Intake</span>
                <h3>Case details before upload</h3>
              </div>
              <button className="ghost-button" onClick={resetPatientWorkspace}>
                Reset case
              </button>
            </div>

            <div className="form-grid">
              <label className="field-group">
                <span>Patient ID</span>
                <input type="text" value={patientForm.patientId} onChange={(event) => updatePatientForm("patientId", event.target.value)} placeholder="VMRI-2026-001" />
              </label>
              <label className="field-group">
                <span>Patient Name</span>
                <input type="text" value={patientForm.patientName} onChange={(event) => updatePatientForm("patientName", event.target.value)} placeholder="Case name or initials" />
              </label>
              <label className="field-group">
                <span>Age</span>
                <input type="text" value={patientForm.age} onChange={(event) => updatePatientForm("age", event.target.value)} placeholder="67" />
              </label>
              <label className="field-group">
                <span>Sex</span>
                <select value={patientForm.sex} onChange={(event) => updatePatientForm("sex", event.target.value)}>
                  <option>Unknown</option>
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                </select>
              </label>
              <label className="field-group">
                <span>Scan Date</span>
                <input type="date" value={patientForm.scanDate} onChange={(event) => updatePatientForm("scanDate", event.target.value)} />
              </label>
              <label className="field-group field-group-wide">
                <span>Clinical Notes</span>
                <textarea rows="4" value={patientForm.clinicalNotes} onChange={(event) => updatePatientForm("clinicalNotes", event.target.value)} placeholder="Motor symptoms, memory decline, referral context, or radiology notes." />
              </label>
            </div>
          </article>

          <article className="upload-panel panel-surface">
            <div className="section-heading">
              <div>
                <span className="report-kicker">{renderIconBadge("MRI")} MRI Intake</span>
                <h3>Study upload and validation</h3>
              </div>
              <div className="status-chip">{loading ? "Analyzing" : "Ready"}</div>
            </div>

            <label className="upload-zone" htmlFor="mri-file">
              <input id="mri-file" type="file" accept=".nii,.nii.gz" onChange={handleFileChange} />
              <span className="upload-zone-title">Drop MRI study here or browse</span>
              <span className="upload-zone-subtitle">Accepted formats: .nii and .nii.gz. Upload one volumetric scan per report.</span>
            </label>

            <div className="upload-meta-list">
              <div className="upload-meta-item">
                <span>Selected study</span>
                <strong>{fileSummary}</strong>
              </div>
              <div className="upload-meta-item">
                <span>Analysis stage</span>
                <strong>{stageLabel}</strong>
              </div>
              <div className="upload-meta-item">
                <span>Validation checklist</span>
                <strong>{patientForm.patientId && patientForm.patientName && file ? "Ready for review" : "Patient ID, name, and MRI file required"}</strong>
              </div>
            </div>

            <div className="timeline">
              {ANALYSIS_STAGES.map((stage, index) => (
                <div
                  key={stage}
                  className={
                    loading && index <= analysisStage
                      ? "timeline-step active"
                      : !loading && result
                        ? "timeline-step done"
                        : "timeline-step"
                  }
                >
                  <span>{index + 1}</span>
                  <strong>{stage}</strong>
                </div>
              ))}
            </div>

            <div className="action-row">
              <button className="primary-button" onClick={handleUpload} disabled={loading}>
                {loading ? "Running Analysis..." : "Run AI Analysis"}
              </button>
              <button className="secondary-button" onClick={handlePrintReport} disabled={!activeReport}>
                Print report
              </button>
              <button className="secondary-button" onClick={handleExportPdf} disabled={!activeReport}>
                Export PDF
              </button>
            </div>

            {error ? <div className="message error-message">{error}</div> : null}
            {loading ? <div className="message info-message">The study is being processed. Large MRI uploads can take a minute.</div> : null}
          </article>
        </section>

        {renderSupportBoards()}
        <section className="report-surface panel-surface report-print-area">
          {renderReportHeader()}
          {activeReport ? renderReport(activeReport) : renderEmptyReport()}
        </section>
      </section>
    );
  }

  function renderSupportBoards() {
    return (
      <section className="support-grid">
        <article className="assistant-panel panel-surface">
          <div className="section-heading">
            <div>
              <span className="report-kicker">{renderIconBadge("Care")} Care Board</span>
              <h3>Suggested next steps</h3>
            </div>
          </div>
          <div className="assistant-list">
            {assistantTips.map((tip) => (
              <div className="assistant-item" key={tip}>
                <span>Suggested</span>
                <p>{tip}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="assistant-panel panel-surface">
          <div className="section-heading">
            <div>
              <span className="report-kicker">{renderIconBadge("Prep")} Case Readiness</span>
              <h3>Review checklist</h3>
            </div>
          </div>
          <div className="checklist">
            {caseChecklist.map((item) => (
              <div className={item.done ? "checklist-item done" : "checklist-item"} key={item.label}>
                <span>{item.done ? "Done" : "Open"}</span>
                <strong>{item.label}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>
    );
  }

  function renderReportHeader() {
    return (
      <div className="report-header">
        <div>
          <span className="report-kicker">{renderIconBadge("Report")} Structured Report</span>
          <h2>{activeReport ? "Clinical Summary" : "No active report"}</h2>
        </div>

        <div className="report-actions">
          <span className="report-endpoint">{activeReport ? `Updated ${formatDate(activeReport.createdAt)}` : "Awaiting first study"}</span>
          <button className="ghost-button" onClick={handleDownloadReport} disabled={!activeReport}>
            Export JSON
          </button>
        </div>
      </div>
    );
  }

  function renderHistoryPanel() {
    return (
      <section className="workspace-column">
        <section className="header-strip panel-surface">
          <div>
            <div className="workspace-badge">{renderIconBadge("Archive")} Report Archive</div>
            <h1 className="dashboard-title">Recent Analyses</h1>
            <p className="dashboard-subtitle">Review stored cases, reopen a prior report, compare two cases, and continue patient discussions.</p>
          </div>
          <button className="secondary-button" onClick={() => setActiveView("analysis")}>
            Back to analysis
          </button>
        </section>

        <section className="filter-panel panel-surface">
          <div className="section-heading">
            <div>
              <span className="report-kicker">{renderIconBadge("Find")} Search and Filters</span>
              <h3>Filter report archive</h3>
            </div>
            <div className="action-row">
              <button className="ghost-button" onClick={resetFilters}>
                Clear filters
              </button>
              <button className="secondary-button" onClick={openComparisonView} disabled={comparisonIds.length !== 2}>
                Compare selected
              </button>
            </div>
          </div>
          <div className="filter-grid">
            <label className="field-group">
              <span>Patient ID</span>
              <input type="text" value={filters.patientId} onChange={(event) => updateFilter("patientId", event.target.value)} placeholder="Search by patient ID" />
            </label>
            <label className="field-group">
              <span>Prediction</span>
              <select value={filters.prediction} onChange={(event) => updateFilter("prediction", event.target.value)}>
                <option value="">All</option>
                <option>Healthy</option>
                <option>Alzheimer</option>
                <option>Parkinson</option>
              </select>
            </label>
            <label className="field-group">
              <span>Status</span>
              <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
                <option value="">All</option>
                {REPORT_STATUS_OPTIONS.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Risk level</span>
              <select value={filters.riskLevel} onChange={(event) => updateFilter("riskLevel", event.target.value)}>
                <option value="">All</option>
                <option>High</option>
                <option>Moderate</option>
                <option>Low</option>
              </select>
            </label>
            <label className="field-group">
              <span>Date from</span>
              <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} />
            </label>
            <label className="field-group">
              <span>Date to</span>
              <input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} />
            </label>
          </div>
        </section>

        <section className="history-layout">
          <article className="history-panel panel-surface">
            <div className="section-heading">
              <div>
                <span className="report-kicker">{renderIconBadge("History")} History</span>
                <h3>Stored reports</h3>
              </div>
              {historyLoading ? <div className="status-chip">Refreshing</div> : <div className="status-chip">{history.length} results</div>}
            </div>

            <div className="history-list">
              {history.length ? (
                history.map((entry) => (
                  <div className={activeReport && activeReport.id === entry.id ? "history-item active" : "history-item"} key={entry.id}>
                    <div className="history-item-head">
                      <strong>{formatPatientLine(entry.patient)}</strong>
                      <span>{entry.analysisStatus || "Draft"}</span>
                    </div>
                    <p>{entry.prediction} - {entry.confidencePercent}% confidence - {entry.confidenceBand || "Review Required"}</p>
                    <small>{formatDate(entry.createdAt)}</small>
                    <div className="history-actions">
                      <button className="ghost-button" onClick={() => handleSelectReport(entry)}>
                        Open
                      </button>
                      <button className={comparisonIds.includes(entry.id) ? "secondary-button selected-compare" : "ghost-button"} onClick={() => toggleComparison(entry.id)}>
                        {comparisonIds.includes(entry.id) ? "Selected" : "Compare"}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state-compact">No reports match the current filters. Clear the filters or run a new study.</div>
              )}
            </div>
          </article>

          <article className="history-report panel-surface report-print-area">
            {renderReportHeader()}
            {activeReport ? renderReport(activeReport) : renderEmptyReport()}
          </article>
        </section>
      </section>
    );
  }

  function renderComparisonPanel() {
    return (
      <section className="workspace-column">
        <section className="header-strip panel-surface">
          <div>
            <div className="workspace-badge">{renderIconBadge("Compare")} Patient Comparison</div>
            <h1 className="dashboard-title">Side-by-side review</h1>
            <p className="dashboard-subtitle">Compare two stored reports across confidence, findings, recommendations, and current review status.</p>
          </div>
          <button className="secondary-button" onClick={() => setActiveView("history")}>
            Back to history
          </button>
        </section>

        <section className="comparison-insight panel-surface">
          <span className="report-kicker">{renderIconBadge("Insight")} Comparison note</span>
          <p>{summarizeComparison(comparisonReports[0], comparisonReports[1])}</p>
        </section>

        <section className="comparison-grid">
          {comparisonReports.length === 2 ? (
            comparisonReports.map((report) => (
              <article key={report.id} className="panel-surface comparison-card report-print-area">
                <div className="comparison-card-head">
                  <h3>{formatPatientLine(report.patient)}</h3>
                  <span>{report.confidenceBand || "Review Required"}</span>
                </div>
                {renderReport(report)}
              </article>
            ))
          ) : (
            <div className="empty-state-premium">
              <h3>Select two reports to compare</h3>
              <p>Use the compare buttons in the report archive to choose exactly two cases.</p>
            </div>
          )}
        </section>
      </section>
    );
  }

  function renderSettingsPanel() {
    const foldAccuracies = modelMetrics?.cvFoldAccuraciesPercent || [];
    const topFeatures = modelMetrics?.topFeatures || [];
    const labelNames = modelMetrics?.labelNames || [];
    const confusionMatrix = modelMetrics?.confusionMatrix || [];

    return (
      <section className="workspace-column">
        <section className="header-strip panel-surface">
          <div>
            <div className="workspace-badge">{renderIconBadge("Ops")} Workspace Summary</div>
            <h1 className="dashboard-title">Operational Snapshot</h1>
            <p className="dashboard-subtitle">A compact view of workflow, class distribution, and recent archive activity.</p>
          </div>
        </section>

        <section className="settings-grid">
          <article className="panel-surface settings-card">
            <span>Workflow focus</span>
            <strong>Patient intake to structured review</strong>
            <p>Use this desk for intake, upload, report review, doctor impression, and clinical handoff in one place.</p>
          </article>
          <article className="panel-surface settings-card">
            <span>Class distribution</span>
            <strong>{Object.entries(quickStats.classCounts).map(([label, count]) => `${label}: ${count}`).join(" | ") || "No reports yet"}</strong>
            <p>The dashboard keeps a simple snapshot of the current archive mix.</p>
          </article>
          <article className="panel-surface settings-card">
            <span>Recent activity</span>
            <strong>{quickStats.recentActivity.length} recent cases</strong>
            <p>Latest archive updates are shown below for quick case-follow-up visibility.</p>
          </article>
          <article className="panel-surface settings-card">
            <span>Model validation</span>
            <strong>{modelMetrics ? `${modelMetrics.cvMeanAccuracyPercent}% CV accuracy` : "Loading metrics"}</strong>
            <p>{modelMetrics ? `${modelMetrics.sampleCount} reference studies with ${modelMetrics.gnnEnabled ? "optional" : "classifier-first"} ensemble inference.` : "Metrics become available when the backend metrics endpoint responds."}</p>
          </article>
        </section>

        <section className="activity-feed panel-surface">
          <div className="section-heading">
            <div>
              <span className="report-kicker">{renderIconBadge("Model")} Validation Summary</span>
              <h3>Classifier quality snapshot</h3>
            </div>
          </div>
          {modelMetrics ? (
            <div className="activity-list">
              <div className="activity-item">
                <strong>Cross-validation folds</strong>
                <p>{foldAccuracies.length ? foldAccuracies.map((score) => `${score}%`).join(" | ") : "Fold accuracies not available."}</p>
              </div>
              <div className="activity-item">
                <strong>Top features</strong>
                <p>{topFeatures.length ? topFeatures.slice(0, 5).map((item) => `${item.name} (${(item.importance * 100).toFixed(1)}%)`).join(" | ") : "Feature importances not available."}</p>
              </div>
              <div className="activity-item">
                <strong>Confusion matrix</strong>
                <p>{confusionMatrix.length ? confusionMatrix.map((row, index) => `${labelNames[index] || `Class ${index}`}: ${row.join(", ")}`).join(" | ") : "Confusion matrix not available."}</p>
              </div>
            </div>
          ) : (
            <div className="empty-state-compact">Model metrics are not available yet. Restart the backend if needed.</div>
          )}
        </section>

        <section className="activity-feed panel-surface">
          <div className="section-heading">
            <div>
              <span className="report-kicker">{renderIconBadge("Feed")} Activity feed</span>
              <h3>Latest case events</h3>
            </div>
          </div>
          <div className="activity-list">
            {quickStats.recentActivity.length ? (
              quickStats.recentActivity.map((entry) => (
                <div className="activity-item" key={entry.id}>
                  <strong>{formatPatientLine(entry.patient)}</strong>
                  <p>{entry.prediction} - {entry.analysisStatus || "Draft"} - {formatDate(entry.createdAt)}</p>
                </div>
              ))
            ) : (
              <div className="empty-state-compact">No activity yet. Run a study to populate the dashboard.</div>
            )}
          </div>
        </section>
      </section>
    );
  }

  function renderScanPreview(report) {
    const preview = report.modelInsights?.preview;
    if (!preview?.dataUrl) {
      return (
        <div className="scan-preview-empty">
          Preview not available for this report.
        </div>
      );
    }

    return (
      <div className="scan-preview">
        <img src={preview.dataUrl} alt="Representative MRI slice preview" />
        <div className="scan-preview-meta">
          <span>Original shape</span>
          <strong>{(report.modelInsights?.originalShape || []).join(" x ") || "Unknown"}</strong>
          <span>Processed shape</span>
          <strong>{(report.modelInsights?.processedShape || []).join(" x ") || "Unknown"}</strong>
          <span>Representative slice</span>
          <strong>{preview.sliceIndex ?? "Unknown"}</strong>
        </div>
      </div>
    );
  }

  function getReportDraft(report) {
    const reportKey = String(report.reportId || report.id);
    return (
      reportDrafts[reportKey] || {
        analysisStatus: report.analysisStatus || "Draft",
        doctorImpression: report.doctorImpression || "",
      }
    );
  }

  function updateReportDraft(report, field, value) {
    const reportKey = String(report.reportId || report.id);
    setReportDrafts((current) => ({
      ...current,
      [reportKey]: {
        ...(current[reportKey] || {
          analysisStatus: report.analysisStatus || "Draft",
          doctorImpression: report.doctorImpression || "",
        }),
        [field]: value,
      },
    }));
  }

  function renderReport(report) {
    const reportDraft = getReportDraft(report);
    const reportKey = String(report.reportId || report.id);
    const saveMessage = saveMessages[reportKey] || "";
    return (
      <div className="report-grid report-grid-structured">
        <div className="summary-tile primary tile-main">
          <span>Primary finding</span>
          <strong>{report.primaryFinding || `${report.prediction} pattern`}</strong>
        </div>
        <div className="summary-tile tile-compact">
          <span>Confidence</span>
          <strong>{report.confidencePercent || 0}%</strong>
          <small>{report.confidenceBand || "Review Required"}</small>
        </div>
        <div className="summary-tile tile-compact">
          <span>Status</span>
          <strong>{report.analysisStatus || report.riskLevel}</strong>
          <small>{report.riskLevel} risk</small>
        </div>

        <div className="report-card report-card-wide">
          <h3>Case overview</h3>
          <div className="overview-grid">
            <div>
              <span>Patient</span>
              <strong>{report.patient?.patientName || "Unnamed case"}</strong>
            </div>
            <div>
              <span>Patient ID</span>
              <strong>{report.patient?.patientId || "Not recorded"}</strong>
            </div>
            <div>
              <span>Age / Sex</span>
              <strong>{report.patient?.age || "Not recorded"} / {report.patient?.sex || "Unknown"}</strong>
            </div>
            <div>
              <span>Scan date</span>
              <strong>{report.patient?.scanDate || "Not recorded"}</strong>
            </div>
            <div>
              <span>Uploaded study</span>
              <strong className="wrap-text">{report.uploadedFile}</strong>
            </div>
            <div>
              <span>Created</span>
              <strong>{formatDate(report.createdAt)}</strong>
            </div>
          </div>
          <div className="clinical-note">
            <span>Clinical notes</span>
            <p>{report.patient?.clinicalNotes || "No additional notes supplied."}</p>
          </div>
        </div>

        <div className="report-card">
          <h3>Scan preview</h3>
          {renderScanPreview(report)}
        </div>

        <div className="report-card">
          <h3>Differential probabilities</h3>
          {(report.probabilities || []).map((item) => (
            <div className="probability-row" key={item.label}>
              <div className="probability-header">
                <span>{item.label}</span>
                <strong>{item.percent}%</strong>
              </div>
              <div className="probability-track">
                <span style={{ width: `${item.percent}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="report-card">
          <h3>Key observations</h3>
          <ul className="feature-list">
            {(report.keyObservations || []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="report-card">
          <h3>Recommendations</h3>
          <ul className="feature-list">
            {(report.recommendations || []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="report-card">
          <h3>Review guidance</h3>
          <div className="diagnostic-list">
            <div>
              <span>Risk level</span>
              <strong>{report.riskLevel}</strong>
            </div>
            <div>
              <span>Model agreement</span>
              <strong>{report.scanSummary?.referenceAgreement ? "Stable" : "Mixed"}</strong>
            </div>
            <div>
              <span>Study confidence</span>
              <strong>{report.confidenceBand || "Review Required"}</strong>
            </div>
            <div>
              <span>Archive status</span>
              <strong>{report.analysisStatus || "Draft"}</strong>
            </div>
          </div>
        </div>

        <div className="report-card report-card-wide">
          <div className="section-heading compact">
            <div>
              <h3>Doctor impression</h3>
              <p className="sub-copy">Write your final note or conclusion under the AI screening result.</p>
            </div>
            <button className="primary-button" onClick={() => handleSaveReportReview(report)}>
              Save review
            </button>
          </div>
          <div className="form-grid review-grid">
            <label className="field-group">
              <span>Report status</span>
              <select
                value={reportDraft.analysisStatus}
                onChange={(event) => updateReportDraft(report, "analysisStatus", event.target.value)}
              >
                {REPORT_STATUS_OPTIONS.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="field-group field-group-wide">
              <span>Doctor impression</span>
              <textarea
                rows="5"
                value={reportDraft.doctorImpression}
                onChange={(event) => updateReportDraft(report, "doctorImpression", event.target.value)}
                placeholder="Summarize your conclusion, follow-up plan, or discussion points."
              />
            </label>
          </div>
          {saveMessage ? <div className="message success-message">{saveMessage}</div> : null}
        </div>

        <div className="report-card">
          <h3>Triage note</h3>
          <p className="triage-note">{report.triageNote || "Routine clinical review recommended."}</p>
        </div>

        <div className="disclaimer-card">
          AI-assisted screening result only. Confirm findings with qualified radiology and neurology review before clinical decision-making.
        </div>
      </div>
    );
  }

  function renderEmptyReport() {
    return (
      <div className="empty-state-premium">
        <h3>No report available</h3>
        <p>Complete patient intake, upload a scan, and run the analysis to generate a structured clinical report.</p>
      </div>
    );
  }

  function renderAssistantDrawer() {
    return (
      <>
        <button className="assistant-toggle" onClick={() => setAssistantOpen((current) => !current)}>
          {assistantOpen ? "Close Assistant" : "Open Assistant"}
        </button>
        <aside className={assistantOpen ? "assistant-drawer open" : "assistant-drawer"}>
          <div className="assistant-drawer-header">
            <div>
              <span className="report-kicker">{renderIconBadge("Help")} Clinical Assistant</span>
              <h3>Case Q and A</h3>
            </div>
            <button className="ghost-button" onClick={() => setAssistantOpen(false)}>
              Close
            </button>
          </div>

          <div className="assistant-chat">
            {assistantMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={message.role === "assistant" ? "chat-bubble assistant" : "chat-bubble user"}>
                {message.text}
              </div>
            ))}
            {assistantLoading ? <div className="chat-bubble assistant">Reviewing the current report context...</div> : null}
          </div>

          <div className="quick-prompt-row">
            {QUICK_PROMPTS.map((prompt) => (
              <button key={prompt} className="quick-prompt" onClick={() => sendAssistantMessage(prompt)}>
                {prompt}
              </button>
            ))}
          </div>

          <div className="assistant-compose">
            <textarea rows="3" value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Ask for a handoff summary, next-step review, confidence explanation, or comparison summary." />
            <button className="primary-button" onClick={() => sendAssistantMessage(assistantInput)}>
              Send
            </button>
          </div>
        </aside>
      </>
    );
  }

  function renderWorkspace() {
    let panel = renderAnalysisPanel();
    if (activeView === "history") {
      panel = renderHistoryPanel();
    } else if (activeView === "compare") {
      panel = renderComparisonPanel();
    } else if (activeView === "settings") {
      panel = renderSettingsPanel();
    }

    return (
      <>
        <main className="workspace-shell">
          {renderSidebar()}
          {panel}
        </main>
        {renderAssistantDrawer()}
      </>
    );
  }

  return currentUser ? renderWorkspace() : renderAuthScreen();
}

export default App;
