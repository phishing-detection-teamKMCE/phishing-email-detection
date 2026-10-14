"""DistilBERT -> multi-head attention -> Conv1d -> BiGRU -> mean+max pooling -> dense -> logit."""
import torch
import torch.nn as nn
from transformers import AutoModel
from .config import MODEL_NAME


class HybridModel(nn.Module):
    def __init__(self, gru_units, dropout, heads=8, filters=128,
                 use_attn=True, use_cnn=True, use_gru=True, bert=None):
        super().__init__()
        self.bert = bert if bert is not None else AutoModel.from_pretrained(MODEL_NAME)
        hid = self.bert.config.hidden_size
        self.use_attn, self.use_cnn, self.use_gru = use_attn, use_cnn, use_gru
        if use_attn:
            self.attn = nn.MultiheadAttention(hid, heads, dropout=0.1, batch_first=True)
            self.norm = nn.LayerNorm(hid)
        dim = hid
        if use_cnn:
            self.conv = nn.Conv1d(hid, filters, kernel_size=3, padding=1)
            self.bn = nn.BatchNorm1d(filters)
            dim = filters
        if use_gru:
            self.gru = nn.GRU(dim, gru_units, batch_first=True, bidirectional=True)
            dim = 2 * gru_units
        self.drop = nn.Dropout(dropout)
        self.fc1 = nn.Linear(2 * dim, 64)
        self.fc2 = nn.Linear(64, 1)

    def head_parameters(self):
        return [p for n, p in self.named_parameters() if not n.startswith("bert.")]

    def forward(self, input_ids, attention_mask):
        h = self.bert(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        if self.use_attn:
            a, _ = self.attn(h, h, h, key_padding_mask=(attention_mask == 0), need_weights=False)
            h = self.norm(h + a)
        if self.use_cnn:
            h = torch.relu(self.bn(self.conv(h.transpose(1, 2)))).transpose(1, 2)
        if self.use_gru:
            h, _ = self.gru(h)
        m = attention_mask.unsqueeze(-1).to(h.dtype)
        mean = (h * m).sum(1) / m.sum(1).clamp(min=1)
        mx = h.masked_fill(m == 0, -1e4).max(1).values
        z = self.drop(torch.cat([mean, mx], dim=1))
        z = self.drop(torch.relu(self.fc1(z)))
        return self.fc2(z).squeeze(-1)
