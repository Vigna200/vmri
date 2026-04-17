import React from "react";

function Result({ data }) {
  return (
    <div className="result-card">
      <h2>Clinical Summary</h2>

      <p><b>Primary Finding:</b> {data.prediction}</p>
      <p><b>Confidence:</b> {data.confidence}</p>

      <h3>Differential Probabilities</h3>
      <ul>
        <li>Healthy: {data.probs.Healthy}</li>
        <li>Alzheimer: {data.probs.Alzheimer}</li>
        <li>Parkinson: {data.probs.Parkinson}</li>
      </ul>

      <h3>Key Observations</h3>
      <ul>
        <li>Reduced variance</li>
        <li>Abnormal intensity distribution</li>
      </ul>

      <h3>Recommendations</h3>
      <ul>
        <li>Cognitive testing</li>
        <li>Neurology consult</li>
      </ul>

      <p className="disclaimer">
        ⚠️ This is an AI-assisted tool. Not a final medical diagnosis.
      </p>
    </div>
  );
}

export default Result;