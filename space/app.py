import re
import numpy as np
import torch
import torch.nn as nn
import gradio as gr
from transformers import AutoTokenizer, AutoModel

MODEL_NAME = "distilbert-base-uncased"
MAX_LEN = 256
GRU_UNITS = 256
DROPOUT = 0.41
torch.set_num_threads(2)

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)


class AblModel(nn.Module):
    def __init__(self, gru_units, dropout, heads=8, filters=128):
        super().__init__()
        self.bert = AutoModel.from_pretrained(MODEL_NAME)
        hid = self.bert.config.hidden_size
        self.attn = nn.MultiheadAttention(
            hid, heads, dropout=0.1, batch_first=True)
        self.norm = nn.LayerNorm(hid)
        self.conv = nn.Conv1d(hid, filters, kernel_size=3, padding=1)
        self.bn = nn.BatchNorm1d(filters)
        self.gru = nn.GRU(filters, gru_units, batch_first=True,
                          bidirectional=True)
        self.drop = nn.Dropout(dropout)
        self.fc1 = nn.Linear(4 * gru_units, 64)
        self.fc2 = nn.Linear(64, 1)

    def forward(self, input_ids, attention_mask):
        out = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        h = out.last_hidden_state
        pad = attention_mask == 0
        a = self.attn(h, h, h, key_padding_mask=pad, need_weights=False)
        h = self.norm(h + a[0])
        c = self.conv(h.transpose(1, 2))
        h = torch.relu(self.bn(c)).transpose(1, 2)
        h, _ = self.gru(h)
        m = attention_mask.unsqueeze(-1).to(h.dtype)
        mean = (h * m).sum(1) / m.sum(1).clamp(min=1)
        mx = h.masked_fill(m == 0, -1e4).max(1).values
        feats = self.drop(torch.cat([mean, mx], dim=1))
        z = self.drop(torch.relu(self.fc1(feats)))
        return self.fc2(z).squeeze(-1)


model = AblModel(GRU_UNITS, DROPOUT)
model.load_state_dict(torch.load("model.pt", map_location="cpu"))
model.eval()


def score(texts):
    probs = []
    for i in range(0, len(texts), 8):
        chunk = texts[i:i + 8]
        enc = tokenizer(chunk, truncation=True, max_length=MAX_LEN,
                        padding="max_length", return_tensors="pt")
        with torch.no_grad():
            logits = model(enc["input_ids"], enc["attention_mask"])
        probs.extend(torch.sigmoid(logits).numpy().tolist())
    return np.array(probs)


def analyze(text):
    text = str(text).strip()[:3000]
    if not text:
        return {}, []
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text)]
    sents = [s for s in sents if s]
    base = " ".join(sents)
    if len(sents) < 2:
        p0 = float(score([base])[0])
        return {"Phishing": p0, "Safe": 1 - p0}, [(base, None)]
    n = min(len(sents), 12)
    variants = [base]
    for i in range(n):
        variants.append(" ".join(sents[:i] + sents[i + 1:]))
    probs = score(variants)
    p0 = float(probs[0])
    out = []
    for i, s in enumerate(sents):
        tag = None
        if i < n:
            d = p0 - float(probs[i + 1])
            if d > 0.03:
                tag = "Pushes toward phishing"
            elif d < -0.03:
                tag = "Pushes toward safe"
        out.append((s + " ", tag))
    return {"Phishing": p0, "Safe": 1 - p0}, out


colors = {
    "Pushes toward phishing": "#ff6b6b",
    "Pushes toward safe": "#51cf66",
}
examples = [
    ["Dear customer, your account will be suspended. Click here immediately to verify your password."],
    ["Hi team, attaching the meeting notes from Tuesday. Let me know if I missed anything."],
]
demo = gr.Interface(
    fn=analyze,
    inputs=gr.Textbox(lines=10, label="Paste email text"),
    outputs=[
        gr.Label(label="Prediction"),
        gr.HighlightedText(label="Sentences that influenced the decision",
                           color_map=colors),
    ],
    examples=examples,
    cache_examples=False,
    title="Phishing Email Detector",
    description="BERT + attention + CNN + BiGRU hybrid model. Trained on an older public email dataset, so it is a research demo and not a security tool.",
)
demo.launch()
