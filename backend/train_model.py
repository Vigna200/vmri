from vg import (
    CLASSIFIER_BUNDLE_PATH,
    REFERENCE_BUNDLE_PATH,
    build_classifier_bundle,
    build_reference_bundle,
)


if __name__ == "__main__":
    bundle = build_reference_bundle()
    classifier_bundle = build_classifier_bundle()
    print(f"Saved reference bundle to {REFERENCE_BUNDLE_PATH}")
    print(f"Reference samples: {len(bundle['labels'])}")
    print(f"Saved classifier bundle to {CLASSIFIER_BUNDLE_PATH}")
    print(f"Classifier CV mean accuracy: {classifier_bundle['cvMeanAccuracy']:.4f}")
    print("Classifier fold accuracies:", ", ".join(f"{score:.4f}" for score in classifier_bundle["cvFoldAccuracies"]))
    print("Top features:", ", ".join(item["name"] for item in classifier_bundle["featureImportances"][:5]))
