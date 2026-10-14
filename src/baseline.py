"""TF-IDF + LinearSVM baseline. Trains in about a minute on CPU and gives a working detector with no GPU.

    python -m src.baseline --data data/Phishing_Email.csv
"""
import argparse
import joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import make_pipeline
from sklearn.svm import LinearSVC
from . import config
from .data import load_clean, split
from .metrics import evaluate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=config.DATA_PATH)
    args = ap.parse_args()
    train, val, test = split(load_clean(args.data))
    pipe = make_pipeline(
        TfidfVectorizer(max_features=50000, ngram_range=(1, 2), sublinear_tf=True),
        CalibratedClassifierCV(LinearSVC(), cv=3),
    )
    pipe.fit(train["text"], train["label"])
    prob = pipe.predict_proba(test["text"])[:, 1]
    print("test:", {k: round(v, 4) for k, v in evaluate(test["label"], prob).items()})
    joblib.dump(pipe, config.BASELINE_PATH)
    print("saved", config.BASELINE_PATH)


if __name__ == "__main__":
    main()
