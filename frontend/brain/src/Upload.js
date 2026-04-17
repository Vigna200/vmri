import React, { useState } from "react";
import axios from "axios";
import Result from "./Result";

function Upload() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);

  const handleUpload = async () => {
    if (!file) {
      alert("Upload MRI (.nii file)");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const res = await axios.post(
      "http://127.0.0.1:5000/predict",
      formData
    );

    setResult(res.data);
  };

  return (
    <div className="card">
      <input
        type="file"
        accept=".nii,.nii.gz"
        onChange={(e) => setFile(e.target.files[0])}
      />

      <button onClick={handleUpload}>Upload MRI</button>

      {result && <Result data={result} />}
    </div>
  );
}

export default Upload;