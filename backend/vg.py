from pathlib import Path

import joblib
import nibabel as nib
import numpy as np
import torch
import torch.nn.functional as F
from skimage.transform import resize
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import StandardScaler
from torch_geometric.data import Data
from torch_geometric.nn import GCNConv


BASE_DIR = Path(__file__).resolve().parent
TARGET_SHAPE = (16, 16, 16)
MODEL_PATH = BASE_DIR / "model.pth"
MODEL_SCALER_PATH = BASE_DIR / "scaler.pkl"
REFERENCE_BUNDLE_PATH = BASE_DIR / "reference_bundle.joblib"
LABEL_MAP = {
    0: "Healthy",
    1: "Alzheimer",
    2: "Parkinson",
}
DATASET_FOLDERS = {
    0: [BASE_DIR / "alzimers" / "cn"],
    1: [BASE_DIR / "alzimers" / "mci", BASE_DIR / "alzimers" / "ad"],
    2: [BASE_DIR / "parkinsons" / "detect", BASE_DIR / "parkinsons" / "disease"],
}


def load_nifti(path):
    return nib.load(str(path)).get_fdata()


def preprocess(volume):
    resized = resize(volume, TARGET_SHAPE, anti_aliasing=True, preserve_range=True)
    normalized = (resized - np.mean(resized)) / (np.std(resized) + 1e-5)
    return normalized


def extract_features(volume):
    return np.concatenate(
        [
            np.mean(volume, axis=(1, 2)),
            np.mean(volume, axis=(0, 2)),
            np.mean(volume, axis=(0, 1)),
            [np.std(volume)],
        ]
    )


def should_skip_reference_file(label_index, file_path):
    filename = file_path.name.lower()
    if label_index == 0 and filename.startswith("ppmi_"):
        return True
    return False


def build_reference_bundle():
    features = []
    labels = []
    source_files = []

    for label_index, folders in DATASET_FOLDERS.items():
        for folder in folders:
            for file_path in sorted(folder.glob("*.nii")):
                if should_skip_reference_file(label_index, file_path):
                    continue

                volume = preprocess(load_nifti(file_path))
                features.append(extract_features(volume))
                labels.append(label_index)
                source_files.append(str(file_path))

    if not features:
        raise RuntimeError("No MRI reference data found for inference.")

    features_array = np.array(features, dtype=np.float32)
    labels_array = np.array(labels, dtype=np.int64)

    scaler = StandardScaler()
    scaled_features = scaler.fit_transform(features_array)

    bundle = {
        "scaler": scaler,
        "features": scaled_features,
        "labels": labels_array,
        "source_files": source_files,
    }
    joblib.dump(bundle, REFERENCE_BUNDLE_PATH)
    return bundle


def load_reference_bundle():
    if REFERENCE_BUNDLE_PATH.exists():
        return joblib.load(REFERENCE_BUNDLE_PATH)
    return build_reference_bundle()


class GNN(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = GCNConv(49, 32)
        self.conv2 = GCNConv(32, 16)
        self.conv3 = GCNConv(16, 8)
        self.fc = torch.nn.Linear(8, 3)

    def forward(self, data):
        x = F.relu(self.conv1(data.x, data.edge_index, data.edge_weight))
        x = F.dropout(x, p=0.4, training=self.training)
        x = F.relu(self.conv2(x, data.edge_index, data.edge_weight))
        x = F.dropout(x, p=0.3, training=self.training)
        x = F.relu(self.conv3(x, data.edge_index, data.edge_weight))
        x = self.fc(x)
        return F.log_softmax(x, dim=1)


def load_saved_model_bundle():
    if not MODEL_PATH.exists() or not MODEL_SCALER_PATH.exists():
        return None, None

    try:
        model = GNN()
        state_dict = torch.load(MODEL_PATH, map_location=torch.device("cpu"))
        model.load_state_dict(state_dict)
        model.eval()
        scaler = joblib.load(MODEL_SCALER_PATH)
        return model, scaler
    except Exception:
        return None, None


REFERENCE_DATA = load_reference_bundle()
SAVED_MODEL, SAVED_MODEL_SCALER = load_saved_model_bundle()


def softmax(values):
    shifted = values - np.max(values)
    exp_values = np.exp(shifted)
    return exp_values / np.sum(exp_values)


def compute_similarity_probabilities(query_vector):
    neighbor_scores = cosine_similarity([query_vector], REFERENCE_DATA["features"])[0]
    label_votes = np.zeros(len(LABEL_MAP), dtype=np.float64)

    top_indices = np.argsort(neighbor_scores)[-5:]
    for index in top_indices:
        label_votes[REFERENCE_DATA["labels"][index]] += max(float(neighbor_scores[index]), 0.0)

    return softmax(label_votes)


def compute_model_probabilities(features):
    if SAVED_MODEL is None or SAVED_MODEL_SCALER is None:
        return None

    try:
        scaled_features = SAVED_MODEL_SCALER.transform([features])
        tensor_features = torch.tensor(scaled_features, dtype=torch.float)
        data = Data(
            x=tensor_features,
            edge_index=torch.tensor([[0], [0]], dtype=torch.long),
            edge_weight=torch.tensor([1.0], dtype=torch.float),
        )

        with torch.no_grad():
            output = SAVED_MODEL(data)

        return torch.exp(output).numpy()[0]
    except Exception:
        return None


def combine_probabilities(reference_probabilities, model_probabilities):
    if model_probabilities is None:
        probabilities = reference_probabilities
    else:
        probabilities = (0.6 * model_probabilities) + (0.4 * reference_probabilities)
        probabilities = probabilities / np.sum(probabilities)

    healthy_probability = float(probabilities[0])
    disease_index = 1 + int(np.argmax(probabilities[1:]))
    disease_probability = float(probabilities[disease_index])

    # When healthy and disease are nearly tied, favor the disease class so the
    # model is less likely to hide suspicious scans behind a default healthy label.
    if np.argmax(probabilities) == 0 and disease_probability >= 0.40 and (healthy_probability - disease_probability) <= 0.06:
        probabilities[0] -= 0.05
        probabilities[disease_index] += 0.05
        probabilities = np.clip(probabilities, 1e-6, None)
        probabilities = probabilities / np.sum(probabilities)

    return probabilities


def build_scan_summary(volume, prediction_label, probabilities):
    std_value = float(np.std(volume))
    mean_value = float(np.mean(volume))
    min_value = float(np.min(volume))
    max_value = float(np.max(volume))

    observations = []

    if std_value < 0.85:
        observations.append(f"Reduced variance detected (std {std_value:.2f}).")
    else:
        observations.append(f"Variance remains within the learned operating range (std {std_value:.2f}).")

    observations.append(
        f"Normalized intensity distribution spans {min_value:.2f} to {max_value:.2f} with mean {mean_value:.2f}."
    )

    if prediction_label == 1:
        observations.append("Feature profile is closest to the learned Alzheimer pattern class.")
    elif prediction_label == 2:
        observations.append("Feature profile is closest to the learned Parkinson pattern class.")
    else:
        observations.append("Feature profile is closest to the learned healthy reference class.")

    return {
        "std": round(std_value, 4),
        "mean": round(mean_value, 4),
        "min": round(min_value, 4),
        "max": round(max_value, 4),
        "topProbability": round(float(np.max(probabilities)), 4),
        "observations": observations,
    }


def predict_new(file_path):
    volume = preprocess(load_nifti(file_path))
    features = extract_features(volume)
    scaled_features = REFERENCE_DATA["scaler"].transform([features])[0]

    reference_probabilities = compute_similarity_probabilities(scaled_features)
    model_probabilities = compute_model_probabilities(features)
    probabilities = combine_probabilities(reference_probabilities, model_probabilities)

    prediction = int(np.argmax(probabilities))
    return prediction, probabilities, build_scan_summary(volume, prediction, probabilities)
