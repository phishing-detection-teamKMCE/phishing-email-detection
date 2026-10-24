"""Train a small TF-IDF + logistic regression model and export it as JSON for the website.

    python -m src.export_web --data data/Phishing_Email.csv --out docs/model.json

The website runs this model inside the browser, so no server is needed for scoring.
"""
import argparse
import json
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from . import config
from .data import load_clean, split
from .metrics import evaluate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=config.DATA_PATH)
    ap.add_argument("--out", default="docs/model.json")
    ap.add_argument("--features", type=int, default=30000)
    args = ap.parse_args()

    train, val, test = split(load_clean(args.data))
    vec = TfidfVectorizer(max_features=args.features, ngram_range=(1, 2),
                          sublinear_tf=True, min_df=2)
    Xtr = vec.fit_transform(train["text"])
    clf = LogisticRegression(C=20, max_iter=3000)
    clf.fit(Xtr, train["label"])

    metrics = {}
    for name, df in (("val", val), ("test", test)):
        prob = clf.predict_proba(vec.transform(df["text"]))[:, 1]
        metrics[name] = {k: round(float(v), 4) for k, v in evaluate(df["label"], prob).items()}
    print("val :", metrics["val"])
    print("test:", metrics["test"])

    terms = vec.get_feature_names_out().tolist()
    model = {
        "terms": terms,
        "idf": [round(float(x), 4) for x in vec.idf_],
        "coef": [round(float(x), 4) for x in clf.coef_[0]],
        "intercept": round(float(clf.intercept_[0]), 4),
        "metrics": metrics["test"],
        "n_train": int(len(train)),
        "n_test": int(len(test)),
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(model, f, separators=(",", ":"))
    print("saved", args.out, f"({len(terms)} terms)")


if __name__ == "__main__":
    main()
