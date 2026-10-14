"""Load a trained detector (hybrid if model.pt exists, else the TF-IDF baseline) and score text.

    python -m src.predict "Dear customer, verify your password now"
"""
import os
import sys
import numpy as np
from . import config as C


class Detector:
    def __init__(self):
        if os.path.exists(C.MODEL_PATH):
            import torch
            from transformers import AutoTokenizer
            from .model import HybridModel
            self.kind = "hybrid"
            self.tok = AutoTokenizer.from_pretrained(C.MODEL_NAME)
            self.model = HybridModel(C.GRU_UNITS, C.DROPOUT)
            self.model.load_state_dict(torch.load(C.MODEL_PATH, map_location="cpu"))
            self.model.eval()
        elif os.path.exists(C.BASELINE_PATH):
            import joblib
            self.kind = "baseline"
            self.pipe = joblib.load(C.BASELINE_PATH)
        else:
            raise FileNotFoundError(
                "No trained model found. Run `python -m src.baseline` (fast, CPU) "
                "or `python -m src.train` (best, GPU) first.")

    def score(self, texts):
        """Return phishing probabilities for a list of texts."""
        if self.kind == "baseline":
            return self.pipe.predict_proba(texts)[:, 1]
        import torch
        probs = []
        for i in range(0, len(texts), 8):
            enc = self.tok(texts[i:i + 8], truncation=True, max_length=C.MAX_LEN,
                           padding="max_length", return_tensors="pt")
            with torch.no_grad():
                logits = self.model(enc["input_ids"], enc["attention_mask"])
            probs.extend(torch.sigmoid(logits).tolist())
        return np.array(probs)


if __name__ == "__main__":
    d = Detector()
    for t in sys.argv[1:]:
        p = float(d.score([t])[0])
        print(f"[{d.kind}] {'PHISHING' if p >= 0.5 else 'SAFE'}  p(phishing)={p:.3f}")
