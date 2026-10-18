# /// script
# requires-python = ">=3.11"
# dependencies = ["garminconnect==0.3.19"]
# ///
"""Sign in to Garmin Connect once and store the tokens where the Worker reads them.

Garmin only accepts logins from clients that look like a browser or the mobile app, which
a Worker can't do, so the login runs here. Your password is sent only to Garmin; the Worker
gets the resulting tokens and refreshes them itself from then on.

Run from the project root:  uv run scripts/garmin_login.py
"""

import getpass
import os
import subprocess
import tempfile

from garminconnect import Garmin

TOKENS_KEY = "garmin-tokens"  # must match TOKENS_KEY in src/garmin.ts


def main() -> None:
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")
    garmin = Garmin(email, password, prompt_mfa=lambda: input("Garmin MFA code: ").strip())
    garmin.login()
    print(f"Signed in to Garmin as {garmin.get_full_name()}.")

    fd, path = tempfile.mkstemp(suffix=".json")  # created with owner-only permissions
    try:
        with os.fdopen(fd, "w") as f:
            f.write(garmin.client.dumps())
        subprocess.run(
            ["npx", "wrangler", "kv", "key", "put", TOKENS_KEY, "--path", path, "--binding", "OAUTH_KV", "--remote"],
            check=True,
        )
    finally:
        os.remove(path)
    print("Tokens stored. Chad the Coach can now read your Garmin data.")


if __name__ == "__main__":
    main()
