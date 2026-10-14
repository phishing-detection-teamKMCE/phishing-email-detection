"""Shared settings. Best hyperparameters come from the Optuna search (results/optuna_trials.csv)."""
MODEL_NAME = "distilbert-base-uncased"
MAX_LEN = 256
BATCH_SIZE = 16
EPOCHS = 3
GRU_UNITS = 256
DROPOUT = 0.4100531
BERT_LR = 4.536e-5
HEAD_LR = 2.3548e-3
WEIGHT_DECAY = 0.01
WARMUP = 0.1
SEED = 42
TEXT_COL = "Email Text"
LABEL_COL = "Email Type"
DATA_PATH = "data/Phishing_Email.csv"
MODEL_PATH = "model.pt"
BASELINE_PATH = "baseline.joblib"
