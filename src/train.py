"""Train the hybrid model (or an ablation) and evaluate it on the clean test set.

    python -m src.train --data data/Phishing_Email.csv
    python -m src.train --no-attn            # ablations: --no-attn --no-cnn --no-gru
    python -m src.train --epochs 1 --limit 500   # quick smoke test
"""
import argparse
import json
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from transformers import AutoTokenizer, get_linear_schedule_with_warmup
from . import config as C
from .data import load_clean, split
from .metrics import evaluate
from .model import HybridModel


def encode(tok, df):
    enc = tok(df["text"].tolist(), truncation=True, max_length=C.MAX_LEN,
              padding="max_length", return_tensors="pt")
    y = torch.tensor(df["label"].values, dtype=torch.float32)
    return TensorDataset(enc["input_ids"], enc["attention_mask"], y)


@torch.no_grad()
def predict(model, ds, device, bs=64):
    model.eval()
    out = []
    for ids, mask, _ in DataLoader(ds, batch_size=bs):
        logits = model(ids.to(device), mask.to(device))
        out.extend(torch.sigmoid(logits.float()).cpu().tolist())
    return np.array(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=C.DATA_PATH)
    ap.add_argument("--out", default=C.MODEL_PATH)
    ap.add_argument("--epochs", type=int, default=C.EPOCHS)
    ap.add_argument("--seed", type=int, default=C.SEED)
    ap.add_argument("--limit", type=int, default=0, help="use only N training rows (debug)")
    ap.add_argument("--no-attn", action="store_true")
    ap.add_argument("--no-cnn", action="store_true")
    ap.add_argument("--no-gru", action="store_true")
    a = ap.parse_args()

    torch.manual_seed(a.seed)
    np.random.seed(a.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print("device:", device)
    if device == "cpu":
        print("WARNING: CPU training is very slow. Use Google Colab (T4 GPU) for the full run.")

    train, val, test = split(load_clean(a.data))
    if a.limit:
        train, val, test = train.head(a.limit), val.head(a.limit), test.head(a.limit)
    print(f"train {len(train)}  val {len(val)}  test {len(test)}")

    tok = AutoTokenizer.from_pretrained(C.MODEL_NAME)
    tr, va, te = encode(tok, train), encode(tok, val), encode(tok, test)
    loader = DataLoader(tr, batch_size=C.BATCH_SIZE, shuffle=True)

    model = HybridModel(C.GRU_UNITS, C.DROPOUT, use_attn=not a.no_attn,
                        use_cnn=not a.no_cnn, use_gru=not a.no_gru).to(device)
    opt = torch.optim.AdamW([
        {"params": model.bert.parameters(), "lr": C.BERT_LR},
        {"params": model.head_parameters(), "lr": C.HEAD_LR},
    ], weight_decay=C.WEIGHT_DECAY)
    steps = len(loader) * a.epochs
    sched = get_linear_schedule_with_warmup(opt, int(C.WARMUP * steps), steps)
    scaler = torch.cuda.amp.GradScaler(enabled=device == "cuda")
    loss_fn = nn.BCEWithLogitsLoss()

    best_f1, best_state = -1.0, None
    for ep in range(a.epochs):
        model.train()
        total = 0.0
        for ids, mask, y in loader:
            ids, mask, y = ids.to(device), mask.to(device), y.to(device)
            opt.zero_grad()
            with torch.autocast(device_type=device, dtype=torch.float16, enabled=device == "cuda"):
                loss = loss_fn(model(ids, mask).float(), y)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            total += loss.item()
        m = evaluate(val["label"], predict(model, va, device))
        print(f"epoch {ep + 1}: loss {total / len(loader):.4f}  val F1 {m['f1']:.4f}  acc {m['accuracy']:.4f}")
        if m["f1"] > best_f1:
            best_f1 = m["f1"]
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    res = evaluate(test["label"], predict(model, te, device))
    print("TEST:", {k: round(v, 4) for k, v in res.items()})
    torch.save(best_state, a.out)
    json.dump(res, open(a.out.replace(".pt", "_test_metrics.json"), "w"), indent=2)
    print("saved", a.out)


if __name__ == "__main__":
    main()
