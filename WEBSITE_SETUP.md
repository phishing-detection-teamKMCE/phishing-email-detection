# Website setup

The website lives in `docs/` and is served free by GitHub Pages. Scoring runs in the visitor's browser.
Accounts and scan history are stored in Supabase (free tier).

## 1. Create the model file (Google Colab)
```python
!git clone https://github.com/phishing-detection-teamKMCE/phishing-email-detection
%cd phishing-email-detection
!pip install -q -r requirements.txt
# upload Phishing_Email.csv into the data/ folder, then:
!python -m src.export_web
from google.colab import files
files.download("docs/model.json")
```
Put the downloaded `model.json` into the repo's `docs/` folder. It is about 1 MB.

## 2. Create the database (Supabase)
1. Sign up at supabase.com and create a new project. Save the database password somewhere safe.
2. SQL Editor -> New query -> paste everything from `supabase_schema.sql` -> Run.
3. Authentication -> Providers -> Email -> turn **Confirm email** off (the free built-in email sender is limited to a few emails per hour).
4. Authentication -> URL Configuration -> set **Site URL** to your Pages address (step 3 below).
5. Project Settings -> API: copy the **Project URL** and the **anon public** key.
6. Paste both into `docs/config.js`. The anon key is meant to be public. Never paste the `service_role` key.

## 3. Publish with GitHub Pages
Repo -> Settings -> Pages -> Source: **Deploy from a branch** -> Branch `main`, folder `/docs` -> Save.
After a minute the site is live at `https://phishing-detection-teamkmce.github.io/phishing-email-detection/`.

## Notes
- Without `config.js` keys the site runs in demo mode: accounts and history stay in the browser only.
- Row-level security makes every user see only their own scans.
- The site uses the light TF-IDF model. The hybrid BERT model stays in the Colab demo.
