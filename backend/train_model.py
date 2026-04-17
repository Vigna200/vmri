from vg import REFERENCE_BUNDLE_PATH, build_reference_bundle


if __name__ == "__main__":
    bundle = build_reference_bundle()
    print(f"Saved reference bundle to {REFERENCE_BUNDLE_PATH}")
    print(f"Reference samples: {len(bundle['labels'])}")
