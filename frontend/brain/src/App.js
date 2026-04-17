import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./styles.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:5000";
const SESSION_STORAGE_KEY = "vmri_session";

const emptyForm = {
  doctorName: "",
  hospitalName: "",
  email: "",
  password: "",
};

function readStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function App() {
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(emptyForm);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const storedSession = readStoredSession();
    if (storedSession) {
      setCurrentUser(storedSession);
    }
  }, []);

  const fileLabel = useMemo(() => {
    if (!file) {
      return "No MRI study selected yet";
    }

    return `${file.name} • ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  }, [file]);

  const updateAuthForm = (field, value) => {
    setAuthForm((current) => ({
      ...current,
      [field]: value,
    }));
    setAuthError("");
    setAuthMessage("");
  };

  const resetAuthForm = () => {
    setAuthForm(emptyForm);
  };

  const handleRegister = async (event) => {
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
      setCurrentUser(response.data.user);
      setAuthMessage("Registration complete. Your clinical workspace is ready.");
      resetAuthForm();
    } catch (requestError) {
      setAuthError(
        requestError.response?.data?.error ||
          "Registration failed. Please check the backend connection and try again."
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (event) => {
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
      setCurrentUser(response.data.user);
      resetAuthForm();
    } catch (requestError) {
      setAuthError(
        requestError.response?.data?.error ||
          "Login failed. Please check the backend connection and try again."
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setCurrentUser(null);
    setResult(null);
    setFile(null);
    setError("");
    setLoading(false);
  };

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setResult(null);
    setError("");
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please choose an MRI file in .nii or .nii.gz format.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/predict`, formData);
      setResult(response.data);
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          "Result could not be generated. Make sure the backend is running and the uploaded MRI file is valid."
      );
    } finally {
      setLoading(false);
    }
  };

  const renderAuthScreen = () => (
    <main className="auth-shell">
      <section className="auth-hero">
        <div className="auth-badge">VMRI Intelligence Suite</div>
        <h1>Clinical neuroimaging, presented like a real hospital platform.</h1>
        <p>
          Register a doctor and hospital workspace, sign in securely on this device, and move
          into a more polished MRI screening experience.
        </p>

        <div className="hero-grid">
          <div className="hero-card">
            <span>Built for</span>
            <strong>Doctors, neurologists, and imaging teams</strong>
          </div>
          <div className="hero-card">
            <span>Workflow</span>
            <strong>Register, upload scan, review clinical summary</strong>
          </div>
          <div className="hero-card">
            <span>Storage mode</span>
            <strong>Hospital accounts stored in backend SQLite</strong>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-tabs">
          <button
            className={authMode === "login" ? "tab-button active" : "tab-button"}
            onClick={() => {
              setAuthMode("login");
              setAuthError("");
              setAuthMessage("");
            }}
          >
            Doctor Login
          </button>
          <button
            className={authMode === "register" ? "tab-button active" : "tab-button"}
            onClick={() => {
              setAuthMode("register");
              setAuthError("");
              setAuthMessage("");
            }}
          >
            Hospital Register
          </button>
        </div>

        <div className="auth-copy">
          <h2>{authMode === "login" ? "Welcome back" : "Create hospital workspace"}</h2>
          <p>
            {authMode === "login"
              ? "Sign in with the doctor account stored in the VMRI backend."
              : "Register a doctor and hospital identity and store it in the backend database."}
          </p>
        </div>

        <form
          className="auth-form"
          onSubmit={authMode === "login" ? handleLogin : handleRegister}
        >
          {authMode === "register" ? (
            <>
              <label className="field-group">
                <span>Doctor Name</span>
                <input
                  type="text"
                  value={authForm.doctorName}
                  onChange={(event) => updateAuthForm("doctorName", event.target.value)}
                  placeholder="Dr. A. Kumar"
                />
              </label>

              <label className="field-group">
                <span>Hospital Name</span>
                <input
                  type="text"
                  value={authForm.hospitalName}
                  onChange={(event) => updateAuthForm("hospitalName", event.target.value)}
                  placeholder="City Neuro Hospital"
                />
              </label>
            </>
          ) : null}

          <label className="field-group">
            <span>Email</span>
            <input
              type="email"
              value={authForm.email}
              onChange={(event) => updateAuthForm("email", event.target.value)}
              placeholder="doctor@hospital.com"
            />
          </label>

          <label className="field-group">
            <span>Password</span>
            <input
              type="password"
              value={authForm.password}
              onChange={(event) => updateAuthForm("password", event.target.value)}
              placeholder="Enter password"
            />
          </label>

          {authError ? <div className="message error-message">{authError}</div> : null}
          {authMessage ? <div className="message success-message">{authMessage}</div> : null}

          <button className="auth-submit" type="submit" disabled={authLoading}>
            {authLoading
              ? "Please wait..."
              : authMode === "login"
                ? "Enter Workspace"
                : "Register and Continue"}
          </button>
        </form>
      </section>
    </main>
  );

  const renderDashboard = () => (
    <main className="dashboard-shell">
      <section className="topbar">
        <div>
          <div className="workspace-badge">Doctor Workspace</div>
          <h1 className="dashboard-title">VMRI Clinical Command Center</h1>
          <p className="dashboard-subtitle">
            {currentUser.doctorName} • {currentUser.hospitalName}
          </p>
        </div>

        <div className="topbar-actions">
          <div className="identity-card">
            <span>{currentUser.email}</span>
            <strong>{currentUser.hospitalName}</strong>
          </div>
          <button className="secondary-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="showcase-panel">
          <div className="showcase-copy">
            <span className="showcase-label">Neurodiagnostic Review</span>
            <h2>Sharper frontend, clearer workflow, more confident reporting.</h2>
            <p>
              This workspace gives doctors a cleaner handoff from scan upload to clinical summary,
              with a premium interface and structured output that is easier to review.
            </p>
          </div>

          <div className="showcase-stats">
            <div className="stat-card">
              <span>Account mode</span>
              <strong>Doctor + hospital login</strong>
            </div>
            <div className="stat-card">
              <span>Accepted scans</span>
              <strong>.nii and .nii.gz</strong>
            </div>
            <div className="stat-card">
              <span>Inference target</span>
              <strong>Healthy / Alzheimer / Parkinson</strong>
            </div>
          </div>
        </article>

        <article className="upload-panel-modern">
          <div className="panel-header">
            <h3>Upload MRI Study</h3>
            <p>Submit one volumetric scan for classification.</p>
          </div>

          <label className="upload-zone" htmlFor="mri-file">
            <input
              id="mri-file"
              type="file"
              accept=".nii,.nii.gz"
              onChange={handleFileChange}
            />
            <span className="upload-zone-title">Choose MRI file</span>
            <span className="upload-zone-subtitle">
              The uploaded study will be sent to the VMRI backend for analysis.
            </span>
          </label>

          <div className="file-pill">{fileLabel}</div>

          <button className="primary-button" onClick={handleUpload} disabled={loading}>
            {loading ? "Analyzing MRI..." : "Run AI Analysis"}
          </button>

          {error ? <div className="message error-message">{error}</div> : null}
          {loading ? <div className="message info-message">MRI study is being processed...</div> : null}
        </article>
      </section>

      <section className="report-surface">
        <div className="report-header">
          <div>
            <span className="report-kicker">Structured Report</span>
            <h2>Clinical Summary</h2>
          </div>
          <span className="report-endpoint">{API_BASE_URL}</span>
        </div>

        {result ? (
          <div className="report-grid">
            <div className="summary-tile primary">
              <span>Primary Finding</span>
              <strong>{result.primaryFinding}</strong>
            </div>
            <div className="summary-tile">
              <span>Confidence</span>
              <strong>{result.confidence}</strong>
            </div>
            <div className="summary-tile">
              <span>Risk Level</span>
              <strong>{result.riskLevel}</strong>
            </div>

            <div className="report-card">
              <h3>Differential Probabilities</h3>
              {result.probabilities.map((item) => (
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
              <h3>Key Observations</h3>
              <ul className="feature-list">
                {result.keyObservations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="report-card">
              <h3>Recommendations</h3>
              <ul className="feature-list">
                {result.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="disclaimer-card">
              Disclaimer: AI-assisted result. Please confirm with a qualified medical
              professional.
            </div>
          </div>
        ) : (
          <div className="empty-state-premium">
            <h3>No report yet</h3>
            <p>
              Select an MRI file and run the analysis. Your result will appear here in a clearer,
              presentation-ready clinical layout.
            </p>
          </div>
        )}
      </section>
    </main>
  );

  return currentUser ? renderDashboard() : renderAuthScreen();
}

export default App;
