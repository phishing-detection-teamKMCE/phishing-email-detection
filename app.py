"""Gradio demo.  Run: python app.py   (needs model.pt or baseline.joblib, see README)."""
import re
import gradio as gr
from src.predict import Detector

det = Detector()


def analyze(text):
    text = str(text).strip()[:3000]
    if not text:
        return {}, []
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]
    base = " ".join(sents)
    if len(sents) < 2:
        p0 = float(det.score([base])[0])
        return {"Phishing": p0, "Safe": 1 - p0}, [(base, None)]
    n = min(len(sents), 12)
    variants = [base] + [" ".join(sents[:i] + sents[i + 1:]) for i in range(n)]
    probs = det.score(variants)
    p0 = float(probs[0])
    out = []
    for i, s in enumerate(sents):
        tag = None
        if i < n:
            d = p0 - float(probs[i + 1])
            tag = "Pushes toward phishing" if d > 0.03 else "Pushes toward safe" if d < -0.03 else None
        out.append((s + " ", tag))
    return {"Phishing": p0, "Safe": 1 - p0}, out


demo = gr.Interface(
    fn=analyze,
    inputs=gr.Textbox(lines=10, label="Paste email text"),
    outputs=[gr.Label(label="Prediction"),
             gr.HighlightedText(label="Sentences that influenced the decision",
                                color_map={"Pushes toward phishing": "#ff6b6b",
                                           "Pushes toward safe": "#51cf66"})],
    examples=[["Dear customer, your account will be suspended. Click here immediately to verify your password."],
              ["Hi team, attaching the meeting notes from Tuesday. Let me know if I missed anything."]],
    cache_examples=False,
    title=f"Phishing Email Detector ({det.kind} model)",
    description="Research demo trained on an older public email dataset. Not a security tool.",
)

if __name__ == "__main__":
    demo.launch()
