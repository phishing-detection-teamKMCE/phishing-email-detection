"""Load the Kaggle phishing-email CSV, clean it, and make a leak-free split."""
import pandas as pd
from sklearn.model_selection import train_test_split
from .config import TEXT_COL, LABEL_COL, SEED


def load_clean(path):
    df = pd.read_csv(path)
    df = df[[TEXT_COL, LABEL_COL]].dropna()
    df.columns = ["text", "label"]
    df["text"] = df["text"].astype(str).str.strip()
    df["label"] = (df["label"].str.lower().str.contains("phish")).astype(int)
    # blank emails are stored as the text "empty" and carry random labels
    df = df[~df["text"].str.lower().isin(["empty", ""])]
    # exact duplicates would leak between train and test
    df = df.drop_duplicates(subset="text").reset_index(drop=True)
    return df


def split(df, seed=SEED):
    """60/20/20 stratified split. Cleaning happens first, so there is no overlap."""
    train, rest = train_test_split(df, test_size=0.4, stratify=df["label"], random_state=seed)
    val, test = train_test_split(rest, test_size=0.5, stratify=rest["label"], random_state=seed)
    return train.reset_index(drop=True), val.reset_index(drop=True), test.reset_index(drop=True)
